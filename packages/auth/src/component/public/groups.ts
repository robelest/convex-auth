import {
  ConvexError,
  Id,
  mutation,
  normalizeTag,
  normalizeTags,
  query,
  TagPair,
  v,
  vGroupDoc,
  vGroupInviteDoc,
  vGroupMemberDoc,
  vInviteAcceptByTokenResult,
  vInviteStatus,
  vPaginated,
  vTag,
} from "./shared";

// ============================================================================
// Groups
// ============================================================================

/**
 * Create a new group. Groups are hierarchical — set `parentGroupId` to nest
 * under an existing group, or omit it to create a root-level group.
 *
 * @returns The ID of the newly created group.
 */
export const groupCreate = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    type: v.optional(v.string()),
    parentGroupId: v.optional(v.id("Group")),
    tags: v.optional(v.array(vTag)),
    extend: v.optional(v.any()),
  },
  returns: v.id("Group"),
  handler: async (ctx, args) => {
    const { tags: rawTags, ...rest } = args;
    const normalizedTags = rawTags ? normalizeTags(rawTags) : undefined;
    const groupId = await ctx.db.insert("Group", {
      ...rest,
      tags: normalizedTags,
    });
    // Sync companion group_tag rows
    if (normalizedTags) {
      for (const tag of normalizedTags) {
        await ctx.db.insert("GroupTag", {
          group_id: groupId,
          key: tag.key,
          value: tag.value,
        });
      }
    }
    return groupId;
  },
});

/** Retrieve a group by its document ID. Returns `null` if not found. */
export const groupGet = query({
  args: { groupId: v.id("Group") },
  returns: v.union(vGroupDoc, v.null()),
  handler: async (ctx, { groupId }) => {
    return await ctx.db.get("Group", groupId);
  },
});

/**
 * List groups with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Empty `where` returns **all** groups.
 */
export const groupList = query({
  args: {
    where: v.optional(
      v.object({
        slug: v.optional(v.string()),
        type: v.optional(v.string()),
        parentGroupId: v.optional(v.id("Group")),
        name: v.optional(v.string()),
        isRoot: v.optional(v.boolean()),
        tagsAll: v.optional(v.array(vTag)),
        tagsAny: v.optional(v.array(vTag)),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("slug"),
        v.literal("type"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // ---- Resolve tag filters into a Set<Id<"Group">> ----
    let tagFilteredIds: Set<string> | null = null;

    if (where.tagsAll && where.tagsAll.length > 0) {
      // Intersect: group must have ALL specified tags
      let allSet: Set<string> | null = null;
      for (const rawTag of where.tagsAll) {
        const t = normalizeTag(rawTag);
        const rows = await ctx.db
          .query("GroupTag")
          .withIndex("by_key_value", (idx) =>
            idx.eq("key", t.key).eq("value", t.value),
          )
          .collect();
        const ids = new Set(rows.map((r) => r.group_id as string));
        if (allSet === null) {
          allSet = ids;
        } else {
          // Intersect
          for (const id of allSet) {
            if (!ids.has(id)) allSet.delete(id);
          }
        }
        // Short-circuit: empty intersection
        if (allSet.size === 0) break;
      }
      tagFilteredIds = allSet ?? new Set();
    }

    if (where.tagsAny && where.tagsAny.length > 0) {
      // Union: group must have at least one of the specified tags
      const anySet = new Set<string>();
      for (const rawTag of where.tagsAny) {
        const t = normalizeTag(rawTag);
        const rows = await ctx.db
          .query("GroupTag")
          .withIndex("by_key_value", (idx) =>
            idx.eq("key", t.key).eq("value", t.value),
          )
          .collect();
        for (const r of rows) {
          anySet.add(r.group_id as string);
        }
      }
      if (tagFilteredIds !== null) {
        // AND with tagsAll result
        for (const id of tagFilteredIds) {
          if (!anySet.has(id)) tagFilteredIds.delete(id);
        }
      } else {
        tagFilteredIds = anySet;
      }
    }

    // ---- Pick best index based on non-tag where fields ----
    let q;
    if (where.type !== undefined && where.parentGroupId !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("type_parent_group_id", (idx) =>
          idx.eq("type", where.type!).eq("parentGroupId", where.parentGroupId!),
        );
    } else if (where.slug !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.type !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("type", (idx) => idx.eq("type", where.type!));
    } else if (where.parentGroupId !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("parent_group_id", (idx) =>
          idx.eq("parentGroupId", where.parentGroupId!),
        );
    } else {
      q = ctx.db.query("Group");
    }

    // Apply remaining non-tag filters not covered by index
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    if (where.isRoot === true) {
      q = q.filter((f) => f.eq(f.field("parentGroupId"), undefined));
    } else if (where.isRoot === false) {
      q = q.filter((f) => f.neq(f.field("parentGroupId"), undefined));
    }
    // slug filter when not used as index
    if (where.slug !== undefined && where.type !== undefined) {
      q = q.filter((f) => f.eq(f.field("slug"), where.slug!));
    }

    q = q.order(order);

    let all = await q.collect();

    // Apply tag filter (intersect with resolved groupIds)
    if (tagFilteredIds !== null) {
      all = all.filter((doc) => tagFilteredIds!.has(doc._id as string));
    }

    // Cursor-based pagination
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const page = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor };
  },
});

/** Update a group's fields (name, slug, tags, extend, parentGroupId). */
export const groupUpdate = mutation({
  args: { groupId: v.id("Group"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { groupId, data }) => {
    // If tags are being updated, normalize and replace the full tag set
    if (data.tags !== undefined) {
      const normalizedTags: TagPair[] = Array.isArray(data.tags)
        ? normalizeTags(data.tags as TagPair[])
        : [];
      // Delete existing group_tag rows for this group
      const existingTags = await ctx.db
        .query("GroupTag")
        .withIndex("by_group", (idx) => idx.eq("group_id", groupId))
        .collect();
      for (const existing of existingTags) {
        await ctx.db.delete("GroupTag", existing._id);
      }
      // Insert new normalized group_tag rows
      for (const tag of normalizedTags) {
        await ctx.db.insert("GroupTag", {
          group_id: groupId,
          key: tag.key,
          value: tag.value,
        });
      }
      // Patch group with normalized tags (empty array = clear all)
      await ctx.db.patch("Group", groupId, {
        ...data,
        tags: normalizedTags.length > 0 ? normalizedTags : undefined,
      });
    } else {
      await ctx.db.patch("Group", groupId, data);
    }
    return null;
  },
});

/**
 * Delete a group and all of its descendants. This cascades to:
 * - All child groups (recursively)
 * - All members of this group and its descendants
 * - All invites for this group and its descendants
 */
export const groupDelete = mutation({
  args: { groupId: v.id("Group") },
  returns: v.null(),
  handler: async (ctx, { groupId }) => {
    const deleteGroup = async (id: typeof groupId) => {
      const children = await ctx.db
        .query("Group")
        .withIndex("parent_group_id", (q) => q.eq("parentGroupId", id))
        .collect();
      for (const child of children) {
        await deleteGroup(child._id);
      }

      const members = await ctx.db
        .query("GroupMember")
        .withIndex("group_id", (q) => q.eq("groupId", id))
        .collect();
      for (const member of members) {
        await ctx.db.delete("GroupMember", member._id);
      }

      const invites = await ctx.db
        .query("GroupInvite")
        .withIndex("group_id", (q) => q.eq("groupId", id))
        .collect();
      for (const invite of invites) {
        await ctx.db.delete("GroupInvite", invite._id);
      }

      // Delete companion group_tag rows
      const tags = await ctx.db
        .query("GroupTag")
        .withIndex("by_group", (q) => q.eq("group_id", id))
        .collect();
      for (const tag of tags) {
        await ctx.db.delete("GroupTag", tag._id);
      }

      await ctx.db.delete("Group", id);
    };

    await deleteGroup(groupId);
    return null;
  },
});

// ============================================================================
// Members
// ============================================================================

/**
 * Add a user as a member of a group.
 *
 * The `role` field is an application-defined string (e.g. "owner", "admin",
 * "member", "viewer"). The auth component stores it but does not enforce
 * access control — your application defines what each role means.
 *
 * Throws `ConvexError` with code `DUPLICATE_MEMBERSHIP` when the user is
 * already a member of the target group.
 *
 * @returns The ID of the new member record.
 */
export const memberAdd = mutation({
  args: {
    groupId: v.id("Group"),
    userId: v.id("User"),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupMember"),
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) =>
        q.eq("groupId", args.groupId).eq("userId", args.userId),
      )
      .unique();
    if (existingMembership !== null) {
      throw new ConvexError({
        code: "DUPLICATE_MEMBERSHIP",
        message: "User is already a member of this group",
        groupId: args.groupId,
        userId: args.userId,
        existingMemberId: existingMembership._id,
      });
    }
    return await ctx.db.insert("GroupMember", args);
  },
});

/** Retrieve a member record by its document ID. Returns `null` if not found. */
export const memberGet = query({
  args: { memberId: v.id("GroupMember") },
  returns: v.union(vGroupMemberDoc, v.null()),
  handler: async (ctx, { memberId }) => {
    return await ctx.db.get("GroupMember", memberId);
  },
});

/**
 * List members with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `groupId`,
 * `userId`, `role`, and `status`.
 */
export const memberList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        userId: v.optional(v.id("User")),
        role: v.optional(v.string()),
        status: v.optional(v.string()),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("role"),
        v.literal("status"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupMemberDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.groupId !== undefined && where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (idx) =>
          idx.eq("groupId", where.groupId!).eq("userId", where.userId!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("GroupMember");
    }

    if (where.role !== undefined) {
      q = q.filter((f) => f.eq(f.field("role"), where.role!));
    }
    if (where.status !== undefined) {
      q = q.filter((f) => f.eq(f.field("status"), where.status!));
    }

    q = q.order(order);

    const all = await q.collect();
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const page = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor };
  },
});

/**
 * @deprecated Use `memberList` with `where: { userId }` instead.
 * Kept for backward compatibility with generated component types.
 */
export const memberListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vGroupMemberDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("GroupMember")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Look up a specific user's membership in a specific group.
 * Returns `null` if the user is not a member of the group.
 */
export const memberGetByGroupAndUser = query({
  args: { groupId: v.id("Group"), userId: v.id("User") },
  returns: v.union(vGroupMemberDoc, v.null()),
  handler: async (ctx, { groupId, userId }) => {
    return await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) =>
        q.eq("groupId", groupId).eq("userId", userId),
      )
      .unique();
  },
});

/** Remove a member from a group by deleting the member record. */
export const memberRemove = mutation({
  args: { memberId: v.id("GroupMember") },
  returns: v.null(),
  handler: async (ctx, { memberId }) => {
    await ctx.db.delete("GroupMember", memberId);
    return null;
  },
});

/**
 * Update a member record's fields (role, status, extend).
 *
 * Common usage: `memberUpdate({ memberId, data: { role: "admin" } })`
 */
export const memberUpdate = mutation({
  args: { memberId: v.id("GroupMember"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { memberId, data }) => {
    await ctx.db.patch("GroupMember", memberId, data);
    return null;
  },
});

// ============================================================================
// Invites
// ============================================================================

/**
 * Create a new platform-level invitation. Optionally set `groupId` to tie
 * the invite to a specific group. The invitation is sent to an email address
 * and includes a hashed token for secure acceptance.
 *
 * Throws `ConvexError` with code `DUPLICATE_INVITE` when a pending invite
 * already exists for the same email and scope:
 * - group invite: same `email` + same `groupId`
 * - platform invite: same `email` with no `groupId`
 *
 * @returns The ID of the new invite record.
 */
export const inviteCreate = mutation({
  args: {
    groupId: v.optional(v.id("Group")),
    invitedByUserId: v.optional(v.id("User")),
    email: v.optional(v.string()),
    tokenHash: v.string(),
    role: v.optional(v.string()),
    status: vInviteStatus,
    expiresTime: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupInvite"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Only check for duplicates when an email is provided.
    // CLI-generated invites (no email) are always allowed.
    if (args.email !== undefined) {
      if (args.groupId !== undefined) {
        const existingGroupInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("group_id_status", (q) =>
            q.eq("groupId", args.groupId).eq("status", "pending"),
          )
          .filter((q) => q.eq(q.field("email"), args.email))
          .collect();

        for (const existingGroupInvite of existingGroupInvites) {
          const isExpired =
            existingGroupInvite.expiresTime !== undefined &&
            existingGroupInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingGroupInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message:
              "A pending invite already exists for this email in this group",
            email: args.email,
            groupId: args.groupId,
            existingInviteId: existingGroupInvite._id,
          });
        }
      } else {
        const existingPlatformInvites = await ctx.db
          .query("GroupInvite")
          .withIndex("email_status", (q) =>
            q.eq("email", args.email).eq("status", "pending"),
          )
          .filter((q) => q.eq(q.field("groupId"), undefined))
          .collect();

        for (const existingPlatformInvite of existingPlatformInvites) {
          const isExpired =
            existingPlatformInvite.expiresTime !== undefined &&
            existingPlatformInvite.expiresTime <= now;
          if (isExpired) {
            await ctx.db.patch("GroupInvite", existingPlatformInvite._id, {
              status: "expired",
            });
            continue;
          }
          throw new ConvexError({
            code: "DUPLICATE_INVITE",
            message: "A pending platform invite already exists for this email",
            email: args.email,
            existingInviteId: existingPlatformInvite._id,
          });
        }
      }
    }
    return await ctx.db.insert("GroupInvite", args);
  },
});

/** Retrieve an invite by its document ID. Returns `null` if not found. */
export const inviteGet = query({
  args: { inviteId: v.id("GroupInvite") },
  returns: v.union(vGroupInviteDoc, v.null()),
  handler: async (ctx, { inviteId }) => {
    return await ctx.db.get("GroupInvite", inviteId);
  },
});

/** Retrieve an invite by hashed token. Returns `null` if not found. */
export const inviteGetByTokenHash = query({
  args: { tokenHash: v.string() },
  returns: v.union(vGroupInviteDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("GroupInvite")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();
  },
});

/**
 * List invites with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `groupId`,
 * `status`, `email`, `invitedByUserId`, `role`, `acceptedByUserId`, and `tokenHash`.
 */
export const inviteList = query({
  args: {
    where: v.optional(
      v.object({
        tokenHash: v.optional(v.string()),
        groupId: v.optional(v.id("Group")),
        status: v.optional(vInviteStatus),
        email: v.optional(v.string()),
        invitedByUserId: v.optional(v.id("User")),
        role: v.optional(v.string()),
        acceptedByUserId: v.optional(v.id("User")),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("status"),
        v.literal("email"),
        v.literal("expiresTime"),
        v.literal("acceptedTime"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupInviteDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    // Pick best index
    let q;
    if (where.tokenHash !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("token_hash", (idx) =>
          idx.eq("tokenHash", where.tokenHash!),
        );
    } else if (
      where.role !== undefined &&
      where.status !== undefined &&
      where.acceptedByUserId !== undefined
    ) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("role_status_accepted_by_user_id", (idx) =>
          idx
            .eq("role", where.role!)
            .eq("status", where.status!)
            .eq("acceptedByUserId", where.acceptedByUserId!),
        );
    } else if (where.groupId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id_status", (idx) =>
          idx.eq("groupId", where.groupId!).eq("status", where.status!),
        );
    } else if (where.email !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("email_status", (idx) =>
          idx.eq("email", where.email!).eq("status", where.status!),
        );
    } else if (
      where.invitedByUserId !== undefined &&
      where.status !== undefined
    ) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("invited_by_user_id_status", (idx) =>
          idx
            .eq("invitedByUserId", where.invitedByUserId!)
            .eq("status", where.status!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("GroupInvite")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("GroupInvite");
    }

    // Apply remaining filters
    if (where.groupId !== undefined) {
      q = q.filter((f) => f.eq(f.field("groupId"), where.groupId!));
    }
    if (where.status !== undefined) {
      q = q.filter((f) => f.eq(f.field("status"), where.status!));
    }
    if (where.email !== undefined) {
      q = q.filter((f) => f.eq(f.field("email"), where.email!));
    }
    if (where.invitedByUserId !== undefined) {
      q = q.filter((f) =>
        f.eq(f.field("invitedByUserId"), where.invitedByUserId!),
      );
    }
    if (where.role !== undefined) {
      q = q.filter((f) => f.eq(f.field("role"), where.role!));
    }
    if (where.acceptedByUserId !== undefined) {
      q = q.filter((f) =>
        f.eq(f.field("acceptedByUserId"), where.acceptedByUserId!),
      );
    }
    if (where.tokenHash !== undefined) {
      q = q.filter((f) => f.eq(f.field("tokenHash"), where.tokenHash!));
    }

    q = q.order(order);

    const all = await q.collect();
    let startIdx = 0;
    if (args.cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === args.cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const page = all.slice(startIdx, startIdx + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]._id : null;
    return { items, nextCursor };
  },
});

/**
 * Accept a pending invitation.
 *
 * Marks the invite as "accepted" and records the acceptance timestamp.
 * Throws a structured `ConvexError` when the invite doesn't exist or is not
 * currently pending.
 *
 * The caller is responsible for creating the corresponding member record.
 */
export const inviteAccept = mutation({
  args: {
    inviteId: v.id("GroupInvite"),
    acceptedByUserId: v.optional(v.id("User")),
  },
  returns: v.null(),
  handler: async (ctx, { inviteId, acceptedByUserId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    if (invite.expiresTime !== undefined && invite.expiresTime <= Date.now()) {
      await ctx.db.patch("GroupInvite", inviteId, {
        status: "expired",
      });
      throw new ConvexError({
        code: "INVITE_EXPIRED",
        message: "Invite has expired",
        inviteId,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, {
      status: "accepted",
      acceptedTime: Date.now(),
      ...(acceptedByUserId ? { acceptedByUserId } : {}),
    });
    return null;
  },
});

/**
 * Accept an invitation by raw token hash and atomically join group membership.
 *
 * Returns idempotent success when the invite was already accepted by the same
 * user. If the invite targets a group, this mutation also ensures membership.
 */
export const inviteAcceptByToken = mutation({
  args: {
    tokenHash: v.string(),
    acceptedByUserId: v.id("User"),
  },
  returns: vInviteAcceptByTokenResult,
  handler: async (ctx, { tokenHash, acceptedByUserId }) => {
    const invite = await ctx.db
      .query("GroupInvite")
      .withIndex("token_hash", (q) => q.eq("tokenHash", tokenHash))
      .first();

    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
      });
    }

    const now = Date.now();
    if (invite.status === "pending") {
      if (invite.expiresTime !== undefined && invite.expiresTime <= now) {
        await ctx.db.patch("GroupInvite", invite._id, { status: "expired" });
        throw new ConvexError({
          code: "INVITE_EXPIRED",
          message: "Invite has expired",
          inviteId: invite._id,
        });
      }
    } else if (invite.status === "accepted") {
      if (invite.acceptedByUserId !== acceptedByUserId) {
        throw new ConvexError({
          code: "INVITE_ALREADY_ACCEPTED",
          message: "Invite already accepted by another user",
          inviteId: invite._id,
        });
      }
    } else {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot accept invite with status "${invite.status}"`,
        inviteId: invite._id,
        currentStatus: invite.status,
      });
    }

    if (invite.email !== undefined) {
      const user = await ctx.db.get("User", acceptedByUserId);
      const normalizedInviteEmail = invite.email.trim().toLowerCase();
      const normalizedUserEmail = user?.email?.trim().toLowerCase();

      if (
        normalizedUserEmail === undefined ||
        normalizedUserEmail !== normalizedInviteEmail
      ) {
        throw new ConvexError({
          code: "INVITE_EMAIL_MISMATCH",
          message: "Invite email does not match accepting user's email",
          inviteId: invite._id,
        });
      }
    }

    let membershipStatus: "joined" | "already_joined" | "not_applicable" =
      "not_applicable";
    let memberId: Id<"GroupMember"> | undefined;

    if (invite.groupId !== undefined) {
      const existingMembership = await ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (q) =>
          q.eq("groupId", invite.groupId!).eq("userId", acceptedByUserId),
        )
        .unique();

      if (existingMembership !== null) {
        membershipStatus = "already_joined";
        memberId = existingMembership._id;
      } else {
        memberId = await ctx.db.insert("GroupMember", {
          groupId: invite.groupId,
          userId: acceptedByUserId,
          role: invite.role,
          status: "active",
        });
        membershipStatus = "joined";
      }
    }

    if (invite.status === "pending") {
      await ctx.db.patch("GroupInvite", invite._id, {
        status: "accepted",
        acceptedByUserId,
        acceptedTime: now,
      });
    }

    const inviteStatus: "accepted" | "already_accepted" =
      invite.status === "accepted" ? "already_accepted" : "accepted";

    return {
      inviteId: invite._id,
      groupId: invite.groupId ?? null,
      memberId,
      inviteStatus,
      membershipStatus,
    };
  },
});

/**
 * Revoke a pending invitation.
 *
 * Marks the invite as "revoked". Throws a structured `ConvexError` when the
 * invite doesn't exist or is not currently pending.
 */
export const inviteRevoke = mutation({
  args: { inviteId: v.id("GroupInvite") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("GroupInvite", inviteId);
    if (invite === null) {
      throw new ConvexError({
        code: "INVITE_NOT_FOUND",
        message: "Invite not found",
        inviteId,
      });
    }
    if (invite.status !== "pending") {
      throw new ConvexError({
        code: "INVITE_NOT_PENDING",
        message: `Cannot revoke invite with status "${invite.status}"`,
        inviteId,
        currentStatus: invite.status,
      });
    }
    await ctx.db.patch("GroupInvite", inviteId, { status: "revoked" });
    return null;
  },
});
