import { mutation, query } from "./functions";
import { auth } from "./auth";
import {
  createGroupInput,
  emptyInput,
  groupIdInput,
} from "./validation";

/**
 * List all groups the current user belongs to.
 */
export const list = query
  .input(emptyInput)
  .handler(async (ctx) => {
    const { items: memberships } = await auth.user.group.list(ctx, {
      userId: ctx.auth.userId,
    });
    const groups = await Promise.all(
      memberships.map(async (membership: { groupId: string; role?: string }) => {
        const group = await auth.group.get(ctx, membership.groupId);
        return group ? { ...group, role: membership.role } : null;
      }),
    );
    return groups.filter((group) => group !== null);
  })
  .public();

/**
 * Get a single group by ID.
 */
export const get = query
  .input(groupIdInput)
  .handler(async (ctx, { groupId }) => {
    return await auth.group.get(ctx, groupId);
  })
  .public();

/**
 * Create a new group (channel). The creator is added as "admin".
 */
export const create = mutation
  .input(createGroupInput)
  .handler(async (ctx, { name, description }) => {
    const groupId = await auth.group.create(ctx, {
      name,
      type: "channel",
      extend: description ? { description } : {},
    });
    await auth.group.member.add(ctx, {
      groupId,
      userId: ctx.auth.userId,
      role: "admin",
    });
    return groupId;
  })
  .public();

/**
 * List members of a group.
 */
export const members = query
  .input(groupIdInput)
  .handler(async (ctx, { groupId }) => {
    const { items: membersList } = await auth.group.member.list(ctx, {
      where: { groupId },
    });
    return await Promise.all(
      membersList.map(async (member: { userId: string; role?: string }) => {
        const user = await auth.user.get(ctx, member.userId);
        return {
          ...member,
          name: user?.name ?? user?.email ?? user?.phone ?? "Anonymous",
        };
      }),
    );
  })
  .public();

/**
 * Join a group. The user is added as "member".
 */
export const join = mutation
  .input(groupIdInput)
  .handler(async (ctx, { groupId }) => {
    await auth.group.member.add(ctx, {
      groupId,
      userId: ctx.auth.userId,
      role: "member",
    });
    return null;
  })
  .public();

/**
 * List all groups (for discovery / joining).
 */
export const listAll = query
  .input(emptyInput)
  .handler(async (ctx) => {
    const { items } = await auth.group.list(ctx, { where: { type: "channel" } });
    return items;
  })
  .public();
