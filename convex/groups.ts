import { v } from "convex/values";
import { query, mutation } from "./functions";
import { auth } from "./auth";

/**
 * List all groups the current user belongs to.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { items: memberships } = await auth.user.group.list(ctx, {
      userId: ctx.auth.userId,
    });
    const groups = await Promise.all(
      memberships.map(async (m: { groupId: string; role?: string }) => {
        const group = await auth.group.get(ctx, m.groupId);
        return group ? { ...group, role: m.role } : null;
      }),
    );
    return groups.filter(Boolean);
  },
});

/**
 * Get a single group by ID.
 */
export const get = query({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    return auth.group.get(ctx, groupId);
  },
});

/**
 * Create a new group (channel). The creator is added as "admin".
 */
export const create = mutation({
  args: { name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, { name, description }) => {
    const groupId = await auth.group.create(ctx, {
      name,
      type: "channel",
      extend: description ? { description } : {},
    });
    // Add creator as admin
    await auth.group.member.add(ctx, {
      groupId,
      userId: ctx.auth.userId,
      role: "admin",
    });
    return groupId;
  },
});

/**
 * List members of a group.
 */
export const members = query({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    const { items: membersList } = await auth.group.member.list(ctx, { where: { groupId } });
    return Promise.all(
      membersList.map(async (m: { userId: string; role?: string }) => {
        const user = await auth.user.get(ctx, m.userId);
        return {
          ...m,
          name: user?.name ?? user?.email ?? user?.phone ?? "Anonymous",
        };
      }),
    );
  },
});

/**
 * Join a group. The user is added as "member".
 */
export const join = mutation({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    await auth.group.member.add(ctx, {
      groupId,
      userId: ctx.auth.userId,
      role: "member",
    });
  },
});

/**
 * List all groups (for discovery / joining).
 */
export const listAll = query({
  args: {},
  handler: async (ctx) => {
    const { items } = await auth.group.list(ctx, { where: { type: "channel" } });
    return items;
  },
});
