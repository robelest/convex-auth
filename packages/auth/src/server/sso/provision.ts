import { ConvexError } from "convex/values";

import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import {
  getGroupConnection,
  getScimConfigByConnection,
  getScimConfigByTokenHash,
  getScimIdentity,
  upsertScimConfig,
  upsertScimIdentity,
} from "../contract";
import type { GroupConnectionPolicy, ConvexAuthMaterializedConfig } from "../types";

type DomainScimConfig = {
  security?: {
    maxRequestSize?: number;
  };
  profile?: {
    mapping?: {
      subject?: string;
      externalId?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      name?: string;
      phone?: string;
      active?: string;
      groups?: string;
      roles?: string;
    };
    extraFields?: Record<string, string>;
  };
};

function getScimConfigShape(scimConfig: { extend?: unknown } | null | undefined): DomainScimConfig {
  return typeof scimConfig?.extend === "object" && scimConfig.extend !== null
    ? (scimConfig.extend as DomainScimConfig)
    : {};
}

const convexError = (data: { code: string; message: string }) => new ConvexError(data);

type ScimDeps = {
  config: ConvexAuthMaterializedConfig;
  requireEnv: (name: string) => string;
  generateRandomString: (length: number, alphabet: string) => string;
  INVITE_TOKEN_ALPHABET: string;
  sha256: (input: string) => Promise<string>;
  loadGroupPolicyOrThrow: (
    ctx: ComponentReadCtx,
    groupId: string,
  ) => Promise<GroupConnectionPolicy>;
  recordGroupAuditEvent: (
    ctx: ComponentCtx,
    data: {
      connectionId?: string;
      groupId: string;
      eventType: string;
      actorType: "user" | "system" | "scim" | "api_key" | "webhook";
      actorId?: string;
      subjectType: string;
      subjectId?: string;
      ok: boolean;
      requestId?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    },
  ) => Promise<string>;
  emitGroupWebhookDeliveries: (
    ctx: ComponentCtx,
    data: {
      connectionId: string;
      eventType: string;
      payload: Record<string, unknown>;
      auditEventId?: string;
    },
  ) => Promise<void>;
};

export function createGroupScimDomain(deps: ScimDeps) {
  const {
    config,
    requireEnv,
    generateRandomString,
    INVITE_TOKEN_ALPHABET,
    sha256,
    loadGroupPolicyOrThrow,
    recordGroupAuditEvent,
    emitGroupWebhookDeliveries,
  } = deps;

  const getScimBasePath = (connectionId: string) =>
    `${requireEnv("CONVEX_SITE_URL")}/connections/${connectionId}/scim/v2`;

  const validateScim = async (ctx: ComponentReadCtx, connectionId: string) => {
    const checks: Array<{
      name: string;
      ok: boolean;
      message?: string;
    }> = [];

    const connection = await getGroupConnection(ctx, config.component.sso, connectionId);

    if (!connection) {
      return {
        ok: false,
        connectionId,
        checks: [
          {
            name: "group_connection_exists",
            ok: false,
            message: "Connection not found.",
          },
        ],
      };
    }

    const policy = await loadGroupPolicyOrThrow(ctx, connection.groupId);
    const scimConfig = await getScimConfigByConnection(ctx, config.component.sso, connectionId);

    const hasConfig = scimConfig !== null && scimConfig !== undefined;
    checks.push({
      name: "scim_config_exists",
      ok: hasConfig,
      message: hasConfig ? undefined : "SCIM has not been configured.",
    });

    const isActive = scimConfig?.status === "active";
    checks.push({
      name: "scim_config_active",
      ok: isActive,
      message: isActive
        ? undefined
        : `SCIM config status is ${hasConfig ? scimConfig?.status : "unknown"}.`,
    });

    const hasToken = typeof scimConfig?.tokenHash === "string" && scimConfig.tokenHash.length > 0;
    checks.push({
      name: "token_hash_set",
      ok: hasToken,
      message: hasToken ? undefined : "SCIM bearer token has not been set.",
    });

    const hasBasePath =
      typeof scimConfig?.basePath === "string" &&
      scimConfig.basePath === getScimBasePath(connection._id);
    checks.push({
      name: "base_path_matches_route",
      ok: hasBasePath,
      message: hasBasePath ? undefined : "SCIM basePath does not match the derived route.",
    });

    const supportsIdempotentExternalId = policy.provisioning.scimReuse.user === "externalId";
    checks.push({
      name: "user_external_id_reuse_enabled",
      ok: supportsIdempotentExternalId,
      message: supportsIdempotentExternalId
        ? undefined
        : "SCIM user retry-safe provisioning works best with scimReuse.user = externalId.",
    });

    checks.push({
      name: "filter_subset_supported",
      ok: true,
      message: "Supported filters: eq, co, sw, ew, pr on common user/group fields.",
    });

    checks.push({
      name: "protocol_capabilities_declared",
      ok: true,
    });

    return {
      ok: checks.every((c) => c.ok),
      connectionId: connection._id,
      basePath: getScimBasePath(connection._id),
      deprovisionMode: policy.provisioning.deprovision.mode,
      capabilities: {
        users: true,
        groups: true,
        patch: true,
        put: true,
        filters: ["eq", "co", "sw", "ew", "pr"],
        bulk: false,
        etag: false,
      },
      checks,
    };
  };

  return {
    configure: async (
      ctx: ComponentCtx,
      data: {
        connectionId: string;
        status?: "draft" | "active" | "disabled";
        security?: {
          maxRequestSize?: number;
        };
        profile?: {
          mapping?: {
            subject?: string;
            externalId?: string;
            email?: string;
            firstName?: string;
            lastName?: string;
            name?: string;
            phone?: string;
            active?: string;
            groups?: string;
            roles?: string;
          };
          extraFields?: Record<string, string>;
        };
      },
    ) => {
      const connection = await getGroupConnection(ctx, config.component.sso, data.connectionId);
      if (connection === null) {
        throw convexError({
          code: "INVALID_PARAMETERS",
          message: "Connection not found.",
        });
      }
      const rawToken = generateRandomString(48, INVITE_TOKEN_ALPHABET);
      const tokenHash = await sha256(rawToken);
      const basePath = getScimBasePath(connection._id);
      const configId = await upsertScimConfig(ctx, config.component.sso, {
        connectionId: connection._id,
        groupId: connection.groupId,
        status: data.status ?? "active",
        basePath,
        tokenHash,
        lastRotatedAt: Date.now(),
        extend: {
          security: data.security,
          profile: data.profile,
        },
      });
      const auditEventId = await recordGroupAuditEvent(ctx, {
        connectionId: connection._id,
        groupId: connection.groupId,
        eventType: "group.sso.scim.configured",
        actorType: "system",
        subjectType: "group_connection_scim",
        subjectId: configId,
        ok: true,
      });
      await emitGroupWebhookDeliveries(ctx, {
        connectionId: connection._id,
        eventType: "group.sso.scim.configured",
        auditEventId,
        payload: { connectionId: connection._id, scimConfigId: configId },
      });
      return {
        connectionId: connection._id,
        configId,
        basePath,
        token: rawToken,
      };
    },
    get: async (ctx: ComponentReadCtx, connectionId: string) => {
      const scimConfig = await getScimConfigByConnection(
        ctx,
        config.component.sso,
        connectionId,
      );
      if (!scimConfig) {
        return null;
      }
      const shape = getScimConfigShape(scimConfig);
      return {
        ...scimConfig,
        security: shape.security,
        profile: shape.profile,
      };
    },
    status: async (ctx: ComponentReadCtx, connectionId: string) => {
      const currentConfig = await getScimConfigByConnection(
        ctx,
        config.component.sso,
        connectionId,
      );
      const result = await validateScim(ctx, connectionId);
      return {
        connectionId,
        configured: currentConfig?.status !== undefined,
        ready: result.ok,
        config: currentConfig,
        checks: result.checks,
        capabilities: "capabilities" in result ? result.capabilities : undefined,
      };
    },
    getConfigByToken: async (ctx: ComponentReadCtx, token: string) => {
      return await getScimConfigByTokenHash(ctx, config.component.sso, await sha256(token));
    },
    validate: async (ctx: ComponentReadCtx, connectionId: string) => {
      return await validateScim(ctx, connectionId);
    },
    identity: {
      get: async (
        ctx: ComponentReadCtx,
        data: {
          connectionId: string;
          resourceType: "user" | "group";
          externalId: string;
        },
      ) => {
        return await getScimIdentity(ctx, config.component.sso, data);
      },
      upsert: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
          groupId: string;
          resourceType: "user" | "group";
          externalId: string;
          userId?: string;
          mappedGroupId?: string;
          active?: boolean;
          raw?: Record<string, unknown>;
        },
      ) => {
        return await upsertScimIdentity(ctx, config.component.sso, {
          ...data,
          lastProvisionedAt: Date.now(),
        });
      },
    },
  };
}
