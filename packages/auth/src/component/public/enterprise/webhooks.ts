import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vEnterpriseWebhookDeliveryDoc,
  vEnterpriseWebhookEndpointDoc,
  vWebhookEndpointStatus,
} from "../../model";

/**
 * Register a new webhook endpoint for an enterprise.
 *
 * Creates an `EnterpriseWebhookEndpoint` document with an initial failure
 * count of `0`. The endpoint status defaults to `"active"` when not
 * explicitly provided. Each endpoint subscribes to a set of event types
 * that determine which deliveries are sent to it.
 *
 * @param args.enterpriseId - The ID of the enterprise this endpoint belongs to.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.url - The HTTPS URL where webhook payloads will be delivered.
 * @param args.status - An optional lifecycle status (`"active"`, `"paused"`, or `"disabled"`). Defaults to `"active"`.
 * @param args.secretHash - A hash of the signing secret used to verify delivery payloads.
 * @param args.subscriptions - An array of event type strings this endpoint subscribes to (e.g. `["user.login", "scim.provision"]`).
 * @param args.createdByUserId - An optional ID of the user who created this endpoint.
 * @param args.extend - An optional arbitrary extension object for custom endpoint metadata.
 * @returns The ID of the newly created `EnterpriseWebhookEndpoint` document.
 *
 * @example
 * ```ts
 * const endpointId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseWebhookEndpointCreate,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     url: "https://acme.com/webhooks/auth",
 *     secretHash: "sha256:whsec_...",
 *     subscriptions: ["user.login", "user.created", "scim.provision"],
 *   },
 * );
 * ```
 */
export const enterpriseWebhookEndpointCreate = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    url: v.string(),
    status: v.optional(vWebhookEndpointStatus),
    secretHash: v.string(),
    subscriptions: v.array(v.string()),
    createdByUserId: v.optional(v.id("User")),
    extend: v.optional(v.any()),
  },
  returns: v.id("EnterpriseWebhookEndpoint"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseWebhookEndpoint", {
      ...args,
      status: args.status ?? "active",
      failureCount: 0,
    });
  },
});

/**
 * List all webhook endpoints registered for an enterprise.
 *
 * Returns all `EnterpriseWebhookEndpoint` documents associated with the
 * given enterprise, regardless of status.
 *
 * @param args.enterpriseId - The ID of the enterprise whose webhook endpoints to list.
 * @returns An array of webhook endpoint documents.
 *
 * @example
 * ```ts
 * const endpoints = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseWebhookEndpointList,
 *   { enterpriseId },
 * );
 * for (const ep of endpoints) {
 *   console.log(ep.url, ep.status, ep.subscriptions);
 * }
 * ```
 */
export const enterpriseWebhookEndpointList = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.array(vEnterpriseWebhookEndpointDoc),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseWebhookEndpoint")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
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
 * @example
 * ```ts
 * const endpoint = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseWebhookEndpointGet,
 *   { endpointId },
 * );
 * if (endpoint) {
 *   console.log(endpoint.url, endpoint.failureCount);
 * }
 * ```
 */
export const enterpriseWebhookEndpointGet = query({
  args: { endpointId: v.id("EnterpriseWebhookEndpoint") },
  returns: v.union(vEnterpriseWebhookEndpointDoc, v.null()),
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseWebhookEndpointUpdate,
 *   {
 *     endpointId,
 *     data: {
 *       status: "paused",
 *       subscriptions: ["user.login"],
 *     },
 *   },
 * );
 * ```
 */
export const enterpriseWebhookEndpointUpdate = mutation({
  args: { endpointId: v.id("EnterpriseWebhookEndpoint"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { endpointId, data }) => {
    await ctx.db.patch(endpointId, data);
    return null;
  },
});

/**
 * Enqueue a webhook delivery for a specific endpoint.
 *
 * Creates a new `EnterpriseWebhookDelivery` document with an initial status
 * of `"pending"` and an attempt count of `0`. The delivery will be picked up
 * by the delivery worker once `nextAttemptAt` is reached.
 *
 * @param args.enterpriseId - The ID of the enterprise the delivery belongs to.
 * @param args.endpointId - The ID of the webhook endpoint this delivery targets.
 * @param args.auditEventId - An optional ID of the audit event that triggered this delivery.
 * @param args.eventType - The event type string describing the payload (e.g. `"user.created"`).
 * @param args.payload - The arbitrary JSON payload to deliver to the endpoint.
 * @param args.nextAttemptAt - Epoch timestamp (ms) when the delivery should first be attempted.
 * @returns The ID of the newly created `EnterpriseWebhookDelivery` document.
 *
 * @example
 * ```ts
 * const deliveryId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseWebhookDeliveryEnqueue,
 *   {
 *     enterpriseId,
 *     endpointId,
 *     auditEventId,
 *     eventType: "user.created",
 *     payload: { userId, email: "jane@acme.com" },
 *     nextAttemptAt: Date.now(),
 *   },
 * );
 * ```
 */
export const enterpriseWebhookDeliveryEnqueue = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    endpointId: v.id("EnterpriseWebhookEndpoint"),
    auditEventId: v.optional(v.id("EnterpriseAuditEvent")),
    eventType: v.string(),
    payload: v.any(),
    nextAttemptAt: v.number(),
  },
  returns: v.id("EnterpriseWebhookDelivery"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseWebhookDelivery", {
      ...args,
      status: "pending",
      attemptCount: 0,
    });
  },
});

/**
 * List pending webhook deliveries that are ready to be attempted.
 *
 * Queries the `status_next_attempt_at` index for deliveries with status
 * `"pending"` whose `nextAttemptAt` is at or before the provided timestamp.
 * This is used by the delivery worker to find deliveries due for processing.
 *
 * @param args.now - The current epoch timestamp (ms) used as the cutoff for `nextAttemptAt`.
 * @param args.limit - Maximum number of deliveries to return (clamped between 1 and 100, defaults to 50).
 * @returns An array of webhook delivery documents ready for dispatch.
 *
 * @example
 * ```ts
 * const ready = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseWebhookDeliveryListReady,
 *   { now: Date.now(), limit: 10 },
 * );
 * for (const delivery of ready) {
 *   await dispatchWebhook(delivery);
 * }
 * ```
 */
export const enterpriseWebhookDeliveryListReady = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.array(vEnterpriseWebhookDeliveryDoc),
  handler: async (ctx, { now, limit }) => {
    return await ctx.db
      .query("EnterpriseWebhookDelivery")
      .withIndex("status_next_attempt_at", (idx) =>
        idx.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});

/**
 * List webhook deliveries for a specific enterprise, ordered by most recent first.
 *
 * Returns deliveries in reverse chronological order, useful for displaying
 * delivery history in an admin dashboard. Includes deliveries of all statuses.
 *
 * @param args.enterpriseId - The ID of the enterprise whose deliveries to list.
 * @param args.limit - Maximum number of deliveries to return (clamped between 1 and 100, defaults to 50).
 * @returns An array of webhook delivery documents, most recent first.
 *
 * @example
 * ```ts
 * const deliveries = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseWebhookDeliveryList,
 *   { enterpriseId, limit: 25 },
 * );
 * for (const d of deliveries) {
 *   console.log(d.eventType, d.status, d.attemptCount);
 * }
 * ```
 */
export const enterpriseWebhookDeliveryList = query({
  args: { enterpriseId: v.id("Enterprise"), limit: v.optional(v.number()) },
  returns: v.array(vEnterpriseWebhookDeliveryDoc),
  handler: async (ctx, { enterpriseId, limit }) => {
    return await ctx.db
      .query("EnterpriseWebhookDelivery")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseWebhookDeliveryPatch,
 *   {
 *     deliveryId,
 *     data: {
 *       status: "delivered",
 *       attemptCount: 1,
 *     },
 *   },
 * );
 * ```
 */
export const enterpriseWebhookDeliveryPatch = mutation({
  args: { deliveryId: v.id("EnterpriseWebhookDelivery"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { deliveryId, data }) => {
    await ctx.db.patch(deliveryId, data);
    return null;
  },
});
