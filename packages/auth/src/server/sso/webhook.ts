import { ConvexError } from "convex/values";

import type { ComponentCtx, ComponentReadCtx } from "../component/context";
import {
  createWebhookEndpoint,
  getWebhookEndpoint,
  listReadyWebhookDeliveries,
  listWebhookDeliveries,
  listWebhookEndpoints,
  patchWebhookDelivery,
  updateWebhookEndpoint,
} from "../contract";
import type { ConvexAuthMaterializedConfig } from "../types";

type WebhookDeps = {
  config: ConvexAuthMaterializedConfig;
  sha256: (input: string) => Promise<string>;
  loadConnectionOrThrow: (
    ctx: ComponentReadCtx,
    connectionId: string,
  ) => Promise<{
    _id: string;
    groupId: string;
    protocol: "oidc" | "saml";
    status: "draft" | "active" | "disabled";
    config?: unknown;
  }>;
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

const convexError = (data: { code: string; message: string }) => new ConvexError(data);

export function createGroupWebhookDomain(deps: WebhookDeps) {
  const {
    config,
    sha256,
    loadConnectionOrThrow,
    recordGroupAuditEvent,
    emitGroupWebhookDeliveries,
  } = deps;

  return {
    endpoint: {
      get: async (ctx: ComponentReadCtx, endpointId: string) => {
        return await getWebhookEndpoint(ctx, config.component.public, endpointId);
      },
      create: async (
        ctx: ComponentCtx,
        data: {
          connectionId: string;
          url: string;
          secret: string;
          subscriptions: string[];
          createdByUserId?: string;
        },
      ) => {
        const connection = await loadConnectionOrThrow(ctx, data.connectionId);
        if (connection === null) {
          throw convexError({
            code: "INVALID_PARAMETERS",
            message: "Connection not found.",
          });
        }
        const secretHash = await sha256(data.secret);
        const endpointId = await createWebhookEndpoint(ctx, config.component.public, {
          connectionId: connection._id,
          groupId: connection.groupId,
          url: data.url,
          secretHash,
          subscriptions: data.subscriptions,
          createdByUserId: data.createdByUserId,
        });
        await recordGroupAuditEvent(ctx, {
          connectionId: connection._id,
          groupId: connection.groupId,
          eventType: "group.sso.webhook.endpoint.created",
          actorType: data.createdByUserId ? "user" : "system",
          actorId: data.createdByUserId,
          subjectType: "group_webhook_endpoint",
          subjectId: endpointId,
          ok: true,
        });
        return { endpointId };
      },
      list: async (ctx: ComponentReadCtx, connectionId: string) => {
        return await listWebhookEndpoints(ctx, config.component.public, connectionId);
      },
      disable: async (ctx: ComponentCtx, endpointId: string) => {
        await updateWebhookEndpoint(ctx, config.component.public, {
          endpointId,
          data: { status: "disabled" },
        });
        return { endpointId };
      },
    },
    emit: async (
      ctx: ComponentCtx,
      data: {
        connectionId: string;
        eventType: string;
        payload: Record<string, unknown>;
        auditEventId?: string;
      },
    ) => {
      await emitGroupWebhookDeliveries(ctx, data);
    },
    delivery: {
      list: async (ctx: ComponentReadCtx, data: { connectionId: string; limit?: number }) => {
        return await listWebhookDeliveries(ctx, config.component.public, data);
      },
      listReady: async (ctx: ComponentReadCtx, limit?: number) => {
        return await listReadyWebhookDeliveries(ctx, config.component.public, {
          now: Date.now(),
          limit,
        });
      },
      markDelivered: async (ctx: ComponentCtx, deliveryId: string, responseStatus?: number) => {
        await patchWebhookDelivery(ctx, config.component.public, {
          deliveryId,
          data: {
            status: "delivered",
            attemptCount: 1,
            lastAttemptAt: Date.now(),
            lastResponseStatus: responseStatus,
          },
        });
      },
      markFailed: async (
        ctx: ComponentCtx,
        deliveryId: string,
        data: {
          attemptCount: number;
          responseStatus?: number;
          error?: string;
          retryAt?: number;
        },
      ) => {
        await patchWebhookDelivery(ctx, config.component.public, {
          deliveryId,
          data: {
            status: data.retryAt ? "pending" : "failed",
            attemptCount: data.attemptCount,
            lastAttemptAt: Date.now(),
            lastResponseStatus: data.responseStatus,
            lastError: data.error,
            nextAttemptAt: data.retryAt ?? Date.now(),
          },
        });
      },
    },
  };
}
