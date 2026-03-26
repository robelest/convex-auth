import { v } from "convex/values";
import { mutation, query } from "../../functions";
import { vAuditActorType, vAuditStatus, vEnterpriseAuditEventDoc } from "../../model";

/**
 * Record a new audit event for an enterprise.
 *
 * Inserts an immutable audit log entry capturing who performed what action,
 * on which subject, and whether it succeeded or failed. Use this to maintain
 * a tamper-evident trail of security-relevant events.
 *
 * @param args.enterpriseId - The ID of the enterprise this event belongs to.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.eventType - A string identifying the type of event (e.g. `"user.login"`, `"scim.provision"`).
 * @param args.actorType - The kind of actor: `"user"`, `"system"`, `"scim"`, `"api_key"`, or `"webhook"`.
 * @param args.actorId - An optional identifier for the actor (e.g. a user ID or API key ID).
 * @param args.subjectType - The type of the resource being acted upon (e.g. `"user"`, `"group"`).
 * @param args.subjectId - An optional identifier for the subject resource.
 * @param args.status - Whether the event represents a `"success"` or `"failure"`.
 * @param args.occurredAt - Epoch timestamp (ms) when the event occurred.
 * @param args.requestId - An optional correlation ID tying this event to a specific request.
 * @param args.ip - An optional IP address of the actor.
 * @param args.metadata - An optional arbitrary object with additional event details.
 * @returns The ID of the newly created `EnterpriseAuditEvent` document.
 *
 * @example
 * ```ts
 * const eventId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseAuditEventCreate,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     eventType: "user.login",
 *     actorType: "user",
 *     actorId: userId,
 *     subjectType: "session",
 *     subjectId: sessionId,
 *     status: "success",
 *     occurredAt: Date.now(),
 *     ip: "203.0.113.42",
 *   },
 * );
 * ```
 */
export const enterpriseAuditEventCreate = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    eventType: v.string(),
    actorType: vAuditActorType,
    actorId: v.optional(v.string()),
    subjectType: v.string(),
    subjectId: v.optional(v.string()),
    status: vAuditStatus,
    occurredAt: v.number(),
    requestId: v.optional(v.string()),
    ip: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("EnterpriseAuditEvent"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("EnterpriseAuditEvent", args);
  },
});

/**
 * List audit events, optionally filtered by enterprise or group.
 *
 * Returns audit events in reverse chronological order. When `enterpriseId` is
 * provided, events are filtered using the `enterprise_id_occurred_at` index.
 * When only `groupId` is provided, the `group_id_occurred_at` index is used.
 * If neither filter is given, the most recent events across all enterprises
 * are returned.
 *
 * @param args.enterpriseId - An optional enterprise ID to scope events to a single enterprise.
 * @param args.groupId - An optional group ID to scope events to a single group.
 * @param args.limit - Maximum number of events to return (clamped between 1 and 100, defaults to 50).
 * @returns An array of audit event documents, most recent first.
 *
 * @example
 * ```ts
 * const events = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseAuditEventList,
 *   { enterpriseId, limit: 20 },
 * );
 * for (const event of events) {
 *   console.log(event.eventType, event.actorType, event.status);
 * }
 * ```
 */
export const enterpriseAuditEventList = query({
  args: {
    enterpriseId: v.optional(v.id("Enterprise")),
    groupId: v.optional(v.id("Group")),
    limit: v.optional(v.number()),
  },
  returns: v.array(vEnterpriseAuditEventDoc),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (args.enterpriseId !== undefined) {
      return await ctx.db
        .query("EnterpriseAuditEvent")
        .withIndex("enterprise_id_occurred_at", (idx) =>
          idx.eq("enterpriseId", args.enterpriseId!),
        )
        .order("desc")
        .take(limit);
    }
    if (args.groupId !== undefined) {
      return await ctx.db
        .query("EnterpriseAuditEvent")
        .withIndex("group_id_occurred_at", (idx) =>
          idx.eq("groupId", args.groupId!),
        )
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("EnterpriseAuditEvent").order("desc").take(limit);
  },
});
