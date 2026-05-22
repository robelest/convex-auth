import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "../../functions";
import { vAuditActorType, vAuditStatus, vGroupAuditEventDoc } from "../../model";

/**
 * Record a new audit event for an group.sso.
 *
 * Inserts an immutable audit log entry capturing who performed what action,
 * on which subject, and whether it succeeded or failed. Use this to maintain
 * a tamper-evident trail of security-relevant events.
 *
 * @param args.connectionId - Optional connection ID when the event belongs to a specific group connection.
 * @param args.groupId - The ID of the root group that owns the group.sso.
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
 * @returns The ID of the newly created `GroupAuditEvent` document.
 *
 */
export const groupAuditEventCreate = internalMutation({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
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
  returns: v.id("GroupAuditEvent"),
  handler: async (ctx, args) => {
    if (args.ip !== undefined && args.requestId !== undefined) {
      return await ctx.db.insert("GroupAuditEvent", args);
    }
    const meta = await safeGetRequestMetadata(ctx);
    return await ctx.db.insert("GroupAuditEvent", {
      ...args,
      ip: args.ip ?? meta?.ip ?? undefined,
      requestId: args.requestId ?? meta?.requestId,
    });
  },
});

async function safeGetRequestMetadata(
  ctx: { meta?: { getRequestMetadata?: () => Promise<{ ip: string | null; requestId: string }> } },
): Promise<{ ip: string | null; requestId: string } | null> {
  if (typeof ctx.meta?.getRequestMetadata !== "function") {
    return null;
  }
  try {
    return await ctx.meta.getRequestMetadata();
  } catch {
    return null;
  }
}

/**
 * List audit events, optionally filtered by group connection or group.
 *
 * Returns audit events in reverse chronological order. When `connectionId` is
 * provided, events are filtered using the `group_connection_id_occurred_at` index.
 * When only `groupId` is provided, the `group_id_occurred_at` index is used.
 * If neither filter is given, the most recent events across all group connections
 * are returned.
 *
 * @param args.connectionId - An optional group connection ID to scope events to a single group.sso.
 * @param args.groupId - An optional group ID to scope events to a single group.
 * @param args.limit - Maximum number of events to return (clamped between 1 and 100, defaults to 50).
 * @returns An array of audit event documents, most recent first.
 *
 */
export const groupAuditEventList = internalQuery({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    groupId: v.optional(v.id("Group")),
    limit: v.optional(v.number()),
  },
  returns: v.array(vGroupAuditEventDoc),
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    if (args.connectionId !== undefined) {
      return await ctx.db
        .query("GroupAuditEvent")
        .withIndex("group_connection_id_occurred_at", (idx) =>
          idx.eq("connectionId", args.connectionId!),
        )
        .order("desc")
        .take(limit);
    }
    if (args.groupId !== undefined) {
      return await ctx.db
        .query("GroupAuditEvent")
        .withIndex("group_id_occurred_at", (idx) => idx.eq("groupId", args.groupId!))
        .order("desc")
        .take(limit);
    }
    throw new ConvexError({
      code: "INVALID_PARAMETERS",
      message:
        "groupAuditEventList requires either `connectionId` or `groupId` to scope the query. Passing neither would walk the entire audit log.",
    });
  },
});
