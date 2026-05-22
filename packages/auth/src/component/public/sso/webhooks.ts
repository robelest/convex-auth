import { Workpool } from "@convex-dev/workpool";
import { v } from "convex/values";

import { components, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../../functions";
import {
  vGroupWebhookDeliveryDoc,
  vGroupWebhookEndpointDoc,
  vWebhookDeliveryStatus,
  vWebhookEndpointStatus,
} from "../../model";

const workpool = new Workpool(components.webhookWorkpool, {
  maxParallelism: 5,
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 1_000, base: 2 },
  retryActionsByDefault: true,
});

/**
 * Register a new webhook endpoint for an group.sso.
 *
 * Creates an `GroupWebhookEndpoint` document with an initial failure
 * count of `0`. The endpoint status defaults to `"active"` when not
 * explicitly provided. Each endpoint subscribes to a set of event types
 * that determine which deliveries are sent to it.
 *
 * @param args.connectionId - The ID of the group connection this endpoint belongs to.
 * @param args.groupId - The ID of the root group that owns the group.sso.
 * @param args.url - The HTTPS URL where webhook payloads will be delivered.
 * @param args.status - An optional lifecycle status (`"active"`, `"paused"`, or `"disabled"`). Defaults to `"active"`.
 * @param args.secretCiphertext - The endpoint signing secret encrypted with `AUTH_SECRET_ENCRYPTION_KEY`. Decrypted at emit time to HMAC-sign each outbound payload.
 * @param args.subscriptions - An array of event type strings this endpoint subscribes to (e.g. `["user.login", "scim.provision"]`).
 * @param args.createdByUserId - An optional ID of the user who created this endpoint.
 * @param args.extend - An optional arbitrary extension object for custom endpoint metadata.
 * @returns The ID of the newly created `GroupWebhookEndpoint` document.
 *
 */
export const groupWebhookEndpointCreate = internalMutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    url: v.string(),
    status: v.optional(vWebhookEndpointStatus),
    secretCiphertext: v.string(),
    subscriptions: v.array(v.string()),
    createdByUserId: v.optional(v.id("User")),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupWebhookEndpoint"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("GroupWebhookEndpoint", {
      ...args,
      status: args.status ?? "active",
      failureCount: 0,
    });
  },
});

/**
 * List all webhook endpoints registered for an group.sso.
 *
 * Returns all `GroupWebhookEndpoint` documents associated with the
 * given group connection, regardless of status.
 *
 * @param args.connectionId - The ID of the group connection whose webhook endpoints to list.
 * @returns An array of webhook endpoint documents.
 *
 */
export const groupWebhookEndpointList = internalQuery({
  args: { connectionId: v.id("GroupConnection") },
  returns: v.array(vGroupWebhookEndpointDoc),
  handler: async (ctx, { connectionId }) => {
    return await ctx.db
      .query("GroupWebhookEndpoint")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();
  },
});

/**
 * Retrieve a single webhook endpoint by its document ID.
 *
 * Returns the full endpoint document if it exists, or `null` if no
 * endpoint is found with the given ID.
 *
 * @param args.endpointId - The document ID of the webhook endpoint to retrieve.
 * @returns The webhook endpoint document, or `null` if not found.
 *
 */
export const groupWebhookEndpointGet = internalQuery({
  args: { endpointId: v.id("GroupWebhookEndpoint") },
  returns: v.union(vGroupWebhookEndpointDoc, v.null()),
  handler: async (ctx, { endpointId }) => {
    return await ctx.db.get(endpointId);
  },
});

/**
 * Partially update (patch) an existing webhook endpoint.
 *
 * Merges the provided `data` fields into the endpoint document. Only the
 * fields present in `data` are changed; all other fields are preserved.
 * Common updates include changing the URL, rotating the secret, updating
 * subscriptions, or changing the status.
 *
 * @param args.endpointId - The document ID of the webhook endpoint to update.
 * @param args.data - An object containing the fields to update (e.g. `{ url, status, subscriptions }`).
 * @returns `null` on success.
 *
 */
export const groupWebhookEndpointUpdate = internalMutation({
  args: {
    endpointId: v.id("GroupWebhookEndpoint"),
    data: v.object({
      url: v.optional(v.string()),
      status: v.optional(vWebhookEndpointStatus),
      secretCiphertext: v.optional(v.string()),
      subscriptions: v.optional(v.array(v.string())),
      lastSuccessAt: v.optional(v.number()),
      lastFailureAt: v.optional(v.number()),
      failureCount: v.optional(v.number()),
      extend: v.optional(v.any()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { endpointId, data }) => {
    await ctx.db.patch(endpointId, data);
    return null;
  },
});

/**
 * Create a webhook delivery for a specific endpoint and enqueue dispatch.
 *
 * Inserts a new `GroupWebhookDelivery` row with status `"pending"` and
 * `attemptCount: 0`, then enqueues {@link groupWebhookDeliveryDispatch} into
 * the workpool. The workpool drives retry/backoff based on the configured
 * default behavior; `nextAttemptAt` is preserved as observable status only.
 *
 * @param args.connectionId - The ID of the group connection the delivery belongs to.
 * @param args.endpointId - The ID of the webhook endpoint this delivery targets.
 * @param args.auditEventId - An optional ID of the audit event that triggered this delivery.
 * @param args.eventType - The event type string describing the payload (e.g. `"user.created"`).
 * @param args.payload - The arbitrary JSON payload to deliver to the endpoint.
 * @param args.nextAttemptAt - Epoch timestamp (ms) for the first attempt. Pass `Date.now()` for immediate.
 * @returns The ID of the newly created `GroupWebhookDelivery` document.
 */
export const groupWebhookDeliveryCreate = internalMutation({
  args: {
    connectionId: v.id("GroupConnection"),
    endpointId: v.id("GroupWebhookEndpoint"),
    auditEventId: v.optional(v.id("GroupAuditEvent")),
    eventType: v.string(),
    payload: v.any(),
    nextAttemptAt: v.number(),
    signature: v.string(),
    signedAt: v.number(),
  },
  returns: v.id("GroupWebhookDelivery"),
  handler: async (ctx, args) => {
    const deliveryId = await ctx.db.insert("GroupWebhookDelivery", {
      ...args,
      status: "pending",
      attemptCount: 0,
    });
    await workpool.enqueueAction(
      ctx,
      internal.public.sso.webhooks.groupWebhookDeliveryDispatch,
      { deliveryId },
      { runAt: args.nextAttemptAt },
    );
    return deliveryId;
  },
});

/**
 * Read a single delivery row by id. Used by the workpool dispatch action.
 */
export const groupWebhookDeliveryGet = internalQuery({
  args: { deliveryId: v.id("GroupWebhookDelivery") },
  returns: v.union(vGroupWebhookDeliveryDoc, v.null()),
  handler: async (ctx, { deliveryId }) => {
    return await ctx.db.get(deliveryId);
  },
});

/**
 * Action that performs the actual HTTP POST for a queued webhook delivery.
 *
 * Looks up the delivery + endpoint, POSTs the signed payload, and patches the
 * delivery status. Throws on non-2xx so the workpool retries with backoff;
 * after `maxAttempts` the workpool marks the work failed and the delivery
 * row stays at `"failed"`.
 *
 * Signature: `X-Auth-Signature: sha256=<hex>` where
 * `hex = HMAC-SHA256(secret, "${signedAt}.${body}")` and `body` is the JSON
 * blob this action sends. Subscribers verify by reconstructing the
 * pre-image with the `X-Auth-Timestamp` header and the raw body. The
 * signature is computed at emit time in the parent app's context (where
 * `decryptSecret` is available) and stored on the delivery row.
 */
export const groupWebhookDeliveryDispatch = internalAction({
  args: { deliveryId: v.id("GroupWebhookDelivery") },
  returns: v.null(),
  handler: async (ctx, { deliveryId }) => {
    const delivery = (await ctx.runQuery(
      internal.public.sso.webhooks.groupWebhookDeliveryGet,
      { deliveryId },
    )) as {
      _id: string;
      endpointId: string;
      eventType: string;
      payload: unknown;
      attemptCount: number;
      signature: string;
      signedAt: number;
    } | null;
    if (!delivery) return null;

    const endpoint = (await ctx.runQuery(
      internal.public.sso.webhooks.groupWebhookEndpointGet,
      { endpointId: delivery.endpointId as Id<"GroupWebhookEndpoint"> },
    )) as { url: string; status: string } | null;
    if (!endpoint || endpoint.status !== "active") {
      await ctx.runMutation(internal.public.sso.webhooks.groupWebhookDeliveryPatch, {
        deliveryId,
        data: {
          status: "failed",
          lastError: "endpoint missing or disabled",
          lastAttemptAt: Date.now(),
          attemptCount: delivery.attemptCount + 1,
        },
      });
      return null;
    }

    const startedAt = Date.now();
    const body = JSON.stringify({
      eventType: delivery.eventType,
      payload: delivery.payload,
    });
    let response: Response;
    try {
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Event-Type": delivery.eventType,
          "X-Auth-Delivery-Id": delivery._id,
          "X-Auth-Timestamp": String(delivery.signedAt),
          "X-Auth-Signature": `sha256=${delivery.signature}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      await ctx.runMutation(internal.public.sso.webhooks.groupWebhookDeliveryPatch, {
        deliveryId,
        data: {
          status: "processing",
          lastError: err instanceof Error ? err.message : String(err),
          lastAttemptAt: startedAt,
          attemptCount: delivery.attemptCount + 1,
        },
      });
      throw err;
    }

    if (!response.ok) {
      await ctx.runMutation(internal.public.sso.webhooks.groupWebhookDeliveryPatch, {
        deliveryId,
        data: {
          status: "processing",
          lastResponseStatus: response.status,
          lastError: `HTTP ${response.status}`,
          lastAttemptAt: startedAt,
          attemptCount: delivery.attemptCount + 1,
        },
      });
      throw new Error(`Webhook delivery failed: HTTP ${response.status}`);
    }

    await ctx.runMutation(internal.public.sso.webhooks.groupWebhookDeliveryPatch, {
      deliveryId,
      data: {
        status: "delivered",
        lastResponseStatus: response.status,
        lastAttemptAt: startedAt,
        attemptCount: delivery.attemptCount + 1,
      },
    });
    return null;
  },
});

/**
 * List webhook deliveries.
 *
 * Accepts exactly one selector:
 * - `connectionId` — all deliveries for a connection, most recent first
 *   (via `group_connection_id`). Includes every status; useful for an
 *   admin delivery-history view.
 * - `now` — pending deliveries due for dispatch: status `"pending"` with
 *   `nextAttemptAt <= now` (via `status_next_attempt_at`). Used by the
 *   delivery worker to find work.
 *
 * @param connectionId - Optional `_id` of the `GroupConnection`.
 * @param now - Optional epoch timestamp (ms) cutoff for `nextAttemptAt`.
 * @param limit - Max deliveries to return (clamped 1–100, default 50).
 * @returns An array of webhook delivery documents.
 *
 */
export const groupWebhookDeliveryList = internalQuery({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(vGroupWebhookDeliveryDoc),
  handler: async (ctx, args) => {
    const take = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (args.now !== undefined) {
      return await ctx.db
        .query("GroupWebhookDelivery")
        .withIndex("status_next_attempt_at", (idx) =>
          idx.eq("status", "pending").lte("nextAttemptAt", args.now!),
        )
        .take(take);
    }
    if (args.connectionId === undefined) return [];
    return await ctx.db
      .query("GroupWebhookDelivery")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", args.connectionId!))
      .order("desc")
      .take(take);
  },
});

/**
 * Partially update (patch) an existing webhook delivery record.
 *
 * Merges the provided `data` fields into the delivery document. This is
 * typically used by the delivery worker to update the delivery status,
 * increment the attempt count, record response codes, or schedule retry
 * timestamps after a delivery attempt.
 *
 * @param args.deliveryId - The document ID of the webhook delivery to update.
 * @param args.data - An object containing the fields to update (e.g. `{ status, attemptCount, nextAttemptAt }`).
 * @returns `null` on success.
 *
 */
export const groupWebhookDeliveryPatch = internalMutation({
  args: {
    deliveryId: v.id("GroupWebhookDelivery"),
    data: v.object({
      status: v.optional(vWebhookDeliveryStatus),
      attemptCount: v.optional(v.number()),
      nextAttemptAt: v.optional(v.number()),
      lastAttemptAt: v.optional(v.number()),
      lastResponseStatus: v.optional(v.number()),
      lastError: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { deliveryId, data }) => {
    await ctx.db.patch(deliveryId, data);
    return null;
  },
});
