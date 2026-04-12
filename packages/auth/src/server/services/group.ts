import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import {
  getGroupConnectionSecret as queryGroupConnectionSecret,
  getGroup,
  getGroupConnection,
  getScimConfigByConnection,
  listWebhookEndpoints,
} from "../contract";
import { configDefaults } from "../config";
import { decryptSecret } from "../secret";
import { getSamlConfig, getOidcConfig } from "../sso/config";
import { normalizeGroupConnectionPolicy } from "../sso/policy";
import { parseScimPath } from "../sso/scim";
import { isGroupSamlSourceActive } from "../sso/shared";
type ComponentCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation"
>;

type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

type RuntimeSamlConfig = {
  idp?: { metadataXml?: string };
};

type RuntimeGroupConnection = {
  _id: string;
  groupId: string;
  protocol: "oidc" | "saml";
  status: "draft" | "active" | "disabled";
  config?: unknown;
};

type RuntimeSamlLoaded = {
  source: { kind: "connection"; id: string };
  config: Record<string, unknown>;
  status: "draft" | "active" | "disabled";
  connection: RuntimeGroupConnection;
};

export function createGroupService(deps: {
  config: ReturnType<typeof configDefaults>;
  sha256: (input: string) => Promise<string>;
}) {
  const { config, sha256 } = deps;
  const connectionNotFoundError = "Connection not found.";

  const getPolicyFromGroup = (group: { policy?: unknown }) =>
    normalizeGroupConnectionPolicy(group.policy);

  const getGroupConnectionSecret = async (
    ctx: ComponentReadCtx | ComponentCtx,
    connectionId: string,
    kind: "oidc_client_secret",
  ) => {
    return await queryGroupConnectionSecret(ctx, config.component.public, {
      connectionId,
      kind,
    });
  };

  const getGroupConnectionOidcConfigWithSecret = async (
    ctx: ComponentReadCtx | ComponentCtx,
    connection: { _id: string; config?: unknown },
  ): Promise<Record<string, unknown>> => {
    const oidc = getOidcConfig(connection.config);
    const secret = await getGroupConnectionSecret(
      ctx,
      connection._id,
      "oidc_client_secret",
    );
    if (secret) {
      const decrypted = await decryptSecret(secret.ciphertext);
      const existingClient =
        typeof oidc.client === "object" && oidc.client !== null
          ? (oidc.client as Record<string, unknown>)
          : {};
      return {
        ...oidc,
        client: { ...existingClient, secret: decrypted },
      };
    }
    return oidc;
  };

  const loadGroupPolicyOrThrow = async (
    ctx: ComponentReadCtx,
    groupId: string,
  ) => {
    const group = await getGroup(ctx, config.component.public, groupId);
    if (!group) {
      throw convexError({
        code: "INVALID_PARAMETERS",
        message: "Group not found.",
      });
    }
    return getPolicyFromGroup(group);
  };

  const loadConnectionOrThrow = async (
    ctx: ComponentReadCtx,
    connectionId: string,
  ): Promise<RuntimeGroupConnection> => {
    const connection = await getGroupConnection(
      ctx,
      config.component.public,
      connectionId,
    );
    if (!connection) {
      throw convexError({
        code: "INVALID_PARAMETERS",
        message: connectionNotFoundError,
      });
    }
    return connection;
  };

  const loadActiveGroupConnectionOrThrow = async (
    ctx: ComponentReadCtx,
    connectionId: string,
  ) => {
    const connection = await loadConnectionOrThrow(ctx, connectionId);
    if (connection.status !== "active") {
      throw convexError({
        code: "INVALID_PARAMETERS",
        message: "Group connection is not active.",
      });
    }
    return connection;
  };

  const loadActiveConnectionSamlOrThrow = async (
    ctx: ComponentReadCtx,
    connectionId: string,
  ) => {
    const connection = await loadConnectionOrThrow(ctx, connectionId);
    const loaded = {
      source: {
        kind: "connection" as const,
        id: connectionId,
      },
      config: (connection.config ?? {}) as Record<string, unknown>,
      status: connection.status,
      connection,
    } satisfies RuntimeSamlLoaded;
    if (!isGroupSamlSourceActive(loaded)) {
      throw convexError({
        code: "INVALID_PARAMETERS",
        message: "Group connection is not active.",
      });
    }
    const saml = getSamlConfig(loaded.config) as RuntimeSamlConfig;
    if (!saml.idp?.metadataXml) {
      throw convexError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "SAML is not configured for this connection.",
      });
    }
    return { loaded, connection, saml };
  };

  const loadConnectionOidcOrThrow = async (
    ctx: ComponentReadCtx,
    connectionId: string,
  ) => {
    const connection = await loadActiveGroupConnectionOrThrow(ctx, connectionId);
    const oidc = await getGroupConnectionOidcConfigWithSecret(ctx, connection);
    if (oidc.enabled !== true) {
      throw convexError({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "OIDC is not configured for this connection.",
      });
    }
    return { connection, oidc };
  };

  const resolveGroupConnectionSsoProtocolOrThrow = async (
    ctx: ComponentReadCtx,
    connectionId: string,
  ): Promise<"oidc" | "saml"> => {
    const connection = await loadActiveGroupConnectionOrThrow(ctx, connectionId);
    if (connection.protocol === "oidc") {
      return "oidc";
    }
    if (connection.protocol === "saml") {
      return "saml";
    }
    throw convexError({
      code: "PROVIDER_NOT_CONFIGURED",
      message: "Group connection protocol is not configured.",
    });
  };

  const validateGroupConnectionPolicy = (
    policy: ReturnType<typeof normalizeGroupConnectionPolicy>,
  ) => {
    const configuredRoleIds = Object.keys(config.authorization.roles);
    const hasConfiguredRoles = configuredRoleIds.length > 0;
    const checks: Array<{
      name: string;
      ok: boolean;
      message?: string;
    }> = [];

    checks.push({ name: "policy_version", ok: policy.version === 1 });
    if (hasConfiguredRoles) {
      checks.push({
        name: "jit_default_role_ids_known",
        ok: policy.provisioning.jit.defaultRoleIds.every(
          (roleId) => config.authorization.roles[roleId] !== undefined,
        ),
        message: policy.provisioning.jit.defaultRoleIds.every(
          (roleId) => config.authorization.roles[roleId] !== undefined,
        )
          ? undefined
          : "JIT defaultRoleIds contains unknown roleIds.",
      });
      checks.push({
        name: "provisioning_role_mapping_targets_known",
        ok: Object.values(policy.provisioning.roles.mapping ?? {}).every(
          (roleIds) =>
            roleIds.every(
              (roleId) => config.authorization.roles[roleId] !== undefined,
            ),
        ),
        message: Object.values(policy.provisioning.roles.mapping ?? {}).every(
          (roleIds) =>
            roleIds.every(
              (roleId) => config.authorization.roles[roleId] !== undefined,
            ),
        )
          ? undefined
          : "Provisioning role mappings contain unknown roleIds.",
      });
      checks.push({
        name: "provisioning_group_mapping_targets_known",
        ok: Object.values(policy.provisioning.groups.mapping ?? {}).every(
          (roleIds) =>
            roleIds.every(
              (roleId) => config.authorization.roles[roleId] !== undefined,
            ),
        ),
        message: Object.values(policy.provisioning.groups.mapping ?? {}).every(
          (roleIds) =>
            roleIds.every(
              (roleId) => config.authorization.roles[roleId] !== undefined,
            ),
        )
          ? undefined
          : "Provisioning group mappings contain unknown roleIds.",
      });
    }
    checks.push({
      name: "scim_reuse_supported",
      ok:
        policy.provisioning.scimReuse.user === "externalId" ||
        policy.provisioning.scimReuse.user === "none",
    });

    return checks;
  };

  const recordGroupAuditEvent = async (
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
  ) => {
    const { ok, ...rest } = data;
    return (await ctx.runMutation(config.component.public.groupAuditEventCreate, {
      ...rest,
      status: ok ? "success" : "failure",
      occurredAt: Date.now(),
    })) as string;
  };

  const emitGroupWebhookDeliveries = async (
    ctx: ComponentCtx,
    data: {
      connectionId: string;
      eventType: string;
      payload: Record<string, unknown>;
      auditEventId?: string;
    },
  ) => {
    const endpoints = await listWebhookEndpoints(
      ctx,
      config.component.public,
      data.connectionId,
    );
    for (const endpoint of endpoints) {
      if (
        endpoint.status !== "active" ||
        !endpoint.subscriptions.includes(data.eventType)
      ) {
        continue;
      }
      await ctx.runMutation(config.component.public.groupWebhookDeliveryEnqueue, {
        connectionId: data.connectionId,
        endpointId: endpoint._id,
        auditEventId: data.auditEventId,
        eventType: data.eventType,
        payload: data.payload,
        nextAttemptAt: Date.now(),
      });
    }
  };

  const getGroupConnectionScimContext = async (
    ctx: ComponentReadCtx,
    request: Request,
  ) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw convexError({
        code: "MISSING_BEARER_TOKEN",
        message: "Missing or malformed Authorization: Bearer header.",
      });
    }
    const token = authHeader.slice(7);
    const parsedPath = parseScimPath(new URL(request.url).pathname);

    // Look up config by connectionId, then constant-time compare token hash
    // to prevent timing attacks on the bearer token.
    const scimConfig = await getScimConfigByConnection(
      ctx,
      config.component.public,
      parsedPath.connectionId,
    );
    const tokenHash = await sha256(token);
    if (
      !scimConfig ||
      scimConfig.status !== "active" ||
      !scimConfig.tokenHash ||
      !constantTimeEqualHex(tokenHash, scimConfig.tokenHash)
    ) {
      throw convexError({
        code: "INVALID_API_KEY",
        message: "Invalid SCIM token.",
      });
    }

    const connection = await getGroupConnection(
      ctx,
      config.component.public,
      scimConfig.connectionId,
    );
    if (connection === null) {
      throw convexError({
        code: "INVALID_PARAMETERS",
        message: connectionNotFoundError,
      });
    }
    return {
      scimConfig,
      connection,
      parsedPath,
    };
  };

  return {
    getGroupConnectionSecret,
    loadGroupPolicyOrThrow,
    loadConnectionOrThrow,
    loadActiveGroupConnectionOrThrow,
    loadActiveConnectionSamlOrThrow,
    loadConnectionOidcOrThrow,
    resolveGroupConnectionSsoProtocolOrThrow,
    validateGroupConnectionPolicy,
    recordGroupAuditEvent,
    emitGroupWebhookDeliveries,
    getGroupConnectionScimContext,
  };
}

function convexError(data: { code: string; message: string }) {
  return new ConvexError(data);
}

/** Constant-time comparison for hex-encoded strings (e.g. SHA-256 hashes). */
function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
