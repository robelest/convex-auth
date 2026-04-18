import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vGroupWebhookDeliveryDoc,
  vGroupWebhookEndpointDoc,
  vWebhookEndpointStatus,
} from "../../model";

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
 * @param args.secretHash - A hash of the signing secret used to verify delivery payloads.
 * @param args.subscriptions - An array of event type strings this endpoint subscribes to (e.g. `["user.login", "scim.provision"]`).
 * @param args.createdByUserId - An optional ID of the user who created this endpoint.
 * @param args.extend - An optional arbitrary extension object for custom endpoint metadata.
 * @returns The ID of the newly created `GroupWebhookEndpoint` document.
 *
 * @example
 * ```ts
 * const endpointId = await ctx.runMutation(
 *   components.auth.group.sso.groupWebhookEndpointCreate,
 *   {
 *     connectionId,
 *     groupId: orgGroupId,
 *     url: "https://acme.com/webhooks/auth",
 *     secretHash: "sha256:whsec_...",
 *     subscriptions: ["user.login", "user.created", "scim.provision"],
 *   },
 * );
 * ```
 */
export const groupWebhookEndpointCreate = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    url: v.string(),
    status: v.optional(vWebhookEndpointStatus),
    secretHash: v.string(),
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
 * @example
 * ```ts
 * const endpoints = await ctx.runQuery(
 *   components.auth.group.sso.groupWebhookEndpointList,
 *   { connectionId },
 * );
 * for (const ep of endpoints) {
 *   console.log(ep.url, ep.status, ep.subscriptions);
 * }
 * ```
 */
export const groupWebhookEndpointList = query({
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
 * @example
 * ```ts
 * const endpoint = await ctx.runQuery(
 *   components.auth.group.sso.groupWebhookEndpointGet,
 *   { endpointId },
 * );
 * if (endpoint) {
 *   console.log(endpoint.url, endpoint.failureCount);
 * }
 * ```
 */
export const groupWebhookEndpointGet = query({
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
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.group.sso.groupWebhookEndpointUpdate,
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
export const groupWebhookEndpointUpdate = mutation({
  args: { endpointId: v.id("GroupWebhookEndpoint"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { endpointId, data }) => {
    await ctx.db.patch(endpointId, data);
    return null;
  },
});

/**
 * Enqueue a webhook delivery for a specific endpoint.
 *
 * Creates a new `GroupWebhookDelivery` document with an initial status
 * of `"pending"` and an attempt count of `0`. The delivery will be picked up
 * by the delivery worker once `nextAttemptAt` is reached.
 *
 * @param args.connectionId - The ID of the group connection the delivery belongs to.
 * @param args.endpointId - The ID of the webhook endpoint this delivery targets.
 * @param args.auditEventId - An optional ID of the audit event that triggered this delivery.
 * @param args.eventType - The event type string describing the payload (e.g. `"user.created"`).
 * @param args.payload - The arbitrary JSON payload to deliver to the endpoint.
 * @param args.nextAttemptAt - Epoch timestamp (ms) when the delivery should first be attempted.
 * @returns The ID of the newly created `GroupWebhookDelivery` document.
 *
 * @example
 * ```ts
 * const deliveryId = await ctx.runMutation(
 *   components.auth.group.sso.groupWebhookDeliveryEnqueue,
 *   {
 *     connectionId,
 *     endpointId,
 *     auditEventId,
 *     eventType: "user.created",
 *     payload: { userId, email: "jane@acme.com" },
 *     nextAttemptAt: Date.now(),
 *   },
 * );
 * ```
 */
export const groupWebhookDeliveryEnqueue = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    endpointId: v.id("GroupWebhookEndpoint"),
    auditEventId: v.optional(v.id("GroupAuditEvent")),
    eventType: v.string(),
    payload: v.any(),
    nextAttemptAt: v.number(),
  },
  returns: v.id("GroupWebhookDelivery"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("GroupWebhookDelivery", {
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
 *   components.auth.group.sso.groupWebhookDeliveryListReady,
 *   { now: Date.now(), limit: 10 },
 * );
 * for (const delivery of ready) {
 *   await dispatchWebhook(delivery);
 * }
 * ```
 */
export const groupWebhookDeliveryListReady = query({
  args: { now: v.number(), limit: v.optional(v.number()) },
  returns: v.array(vGroupWebhookDeliveryDoc),
  handler: async (ctx, { now, limit }) => {
    return await ctx.db
      .query("GroupWebhookDelivery")
      .withIndex("status_next_attempt_at", (idx) =>
        idx.eq("status", "pending").lte("nextAttemptAt", now),
      )
      .take(Math.min(Math.max(limit ?? 50, 1), 100));
  },
});

/**
 * List webhook deliveries for a specific group connection, ordered by most recent first.
 *
 * Returns deliveries in reverse chronological order, useful for displaying
 * delivery history in an admin dashboard. Includes deliveries of all statuses.
 *
 * @param args.connectionId - The ID of the group connection whose deliveries to list.
 * @param args.limit - Maximum number of deliveries to return (clamped between 1 and 100, defaults to 50).
 * @returns An array of webhook delivery documents, most recent first.
 *
 * @example
 * ```ts
 * const deliveries = await ctx.runQuery(
 *   components.auth.group.sso.groupWebhookDeliveryList,
 *   { connectionId, limit: 25 },
 * );
 * for (const d of deliveries) {
 *   console.log(d.eventType, d.status, d.attemptCount);
 * }
 * ```
 */
export const groupWebhookDeliveryList = query({
  args: {
    connectionId: v.id("GroupConnection"),
    limit: v.optional(v.number()),
  },
  returns: v.array(vGroupWebhookDeliveryDoc),
  handler: async (ctx, { connectionId, limit }) => {
    return await ctx.db
      .query("GroupWebhookDelivery")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
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
 *   components.auth.group.sso.groupWebhookDeliveryPatch,
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
export const groupWebhookDeliveryPatch = mutation({
  args: { deliveryId: v.id("GroupWebhookDelivery"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { deliveryId, data }) => {
    await ctx.db.patch(deliveryId, data);
    return null;
  },
});
