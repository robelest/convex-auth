import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { mutation, query } from "../../functions";
import { vGroupMemberDoc, vPaginated } from "../../model";

/**
 * Add a user as a member of a group.
 *
 * The `roleIds` field stores application-defined role identifiers. The auth
 * component stores assignments but does not enforce access control — your
 * application defines what each role means.
 *
 * Throws `ConvexError` with code `DUPLICATE_MEMBERSHIP` when the user is
 * already a member of the target group. The duplicate check uses the
 * `group_id_user_id` compound index for an exact match.
 *
 * @param args.groupId - The `Id<"Group">` of the group to add the user to.
 * @param args.userId - The `Id<"User">` of the user to add as a member.
 * @param args.roleIds - Optional array of application-defined role identifiers (e.g. `["admin", "editor"]`).
 * @param args.status - Optional membership status string (e.g. `"active"`, `"suspended"`). Defaults to whatever your application convention is.
 * @param args.extend - Optional arbitrary payload for application-specific metadata on the membership.
 * @returns The `Id<"GroupMember">` of the newly created member document.
 * @throws `ConvexError` with code `DUPLICATE_MEMBERSHIP` if the user is already a member of this group.
 *
 */
export const memberAdd = mutation({
  args: {
    groupId: v.id("Group"),
    userId: v.id("User"),
    roleIds: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupMember"),
  handler: async (ctx, args) => {
    const existingMembership = await ctx.db
      .query("GroupMember")
      .withIndex("group_id_user_id", (q) => q.eq("groupId", args.groupId).eq("userId", args.userId))
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

/**
 * Read a membership by identity. Accepts exactly one selector:
 * - `{ id }` — point lookup → `Doc | null`.
 * - `{ groupId, userId }` — unique per group+user → `Doc | null`.
 * - `{ userId, groupIds }` — batch: resolve this user's membership in
 *   each group, returning `(Doc | null)[]` aligned to `groupIds` order
 *   (duplicates de-duplicated internally).
 */
export const memberGet = query({
  args: {
    id: v.optional(v.id("GroupMember")),
    groupId: v.optional(v.id("Group")),
    userId: v.optional(v.id("User")),
    groupIds: v.optional(v.array(v.id("Group"))),
  },
  returns: v.union(
    vGroupMemberDoc,
    v.null(),
    v.array(v.union(vGroupMemberDoc, v.null())),
  ),
  handler: async (ctx, args) => {
    if (args.userId !== undefined && args.groupIds !== undefined) {
      const groupIds = args.groupIds;
      if (groupIds.length === 0) return [];
      const unique = Array.from(new Set(groupIds));
      const docs = await Promise.all(
        unique.map((groupId) =>
          ctx.db
            .query("GroupMember")
            .withIndex("group_id_user_id", (q) =>
              q.eq("groupId", groupId).eq("userId", args.userId!),
            )
            .unique(),
        ),
      );
      const byGroupId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
      return groupIds.map((id) => byGroupId.get(id) ?? null);
    }
    if (args.groupId !== undefined && args.userId !== undefined) {
      return await ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (q) =>
          q.eq("groupId", args.groupId!).eq("userId", args.userId!),
        )
        .unique();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("GroupMember", args.id);
  },
});

/**
 * List members with optional filtering, sorting, and pagination.
 *
 * Returns a Convex-native `PaginationResult<GroupMemberDoc>` so consumers can
 * pass the query directly to `usePaginatedQuery`. Supports filtering by
 * `groupId`, `userId`, `roleId`, and `status`. The query engine automatically
 * selects the best compound index based on the combination of filter fields
 * provided. The `roleId` filter forces in-memory pagination because role IDs
 * are stored as an array.
 *
 * @param args.where - Optional filter criteria for narrowing results.
 * @param args.where.groupId - Match members belonging to this group.
 * @param args.where.userId - Match members for this specific user.
 * @param args.where.roleId - Match members whose `roleIds` array includes this role identifier.
 * @param args.where.status - Match members with this exact status string (e.g. `"active"`).
 * @param args.paginationOpts - Convex `paginationOptsValidator` shape
 *   (`{ numItems, cursor }`).
 * @param args.orderBy - The field to sort by: `"_creationTime"` or `"status"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (defaults to `"desc"`).
 * @returns A Convex `PaginationResult<GroupMemberDoc>` — `{ page, isDone, continueCursor }`.
 *
 */
export const memberList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        userId: v.optional(v.id("User")),
        roleId: v.optional(v.string()),
        status: v.optional(v.string()),
      }),
    ),
    paginationOpts: paginationOptsValidator,
    orderBy: v.optional(v.union(v.literal("_creationTime"), v.literal("status"))),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vGroupMemberDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const order = args.order ?? "desc";
    const numItems = args.paginationOpts.numItems;
    const cursor = args.paginationOpts.cursor;

    let q;
    if (where.groupId !== undefined && where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (idx) =>
          idx.eq("groupId", where.groupId!).eq("userId", where.userId!),
        );
      if (where.status !== undefined) {
        q = q.filter((f) => f.eq(f.field("status"), where.status!));
      }
    } else if (where.groupId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id_status", (idx) =>
          idx.eq("groupId", where.groupId!).eq("status", where.status!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.userId !== undefined) {
      q = ctx.db
        .query("GroupMember")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
      if (where.status !== undefined) {
        q = q.filter((f) => f.eq(f.field("status"), where.status!));
      }
    } else {
      q = ctx.db.query("GroupMember");
      if (where.status !== undefined) {
        q = q.filter((f) => f.eq(f.field("status"), where.status!));
      }
    }

    if (where.roleId === undefined) {
      return await q.order(order).paginate(args.paginationOpts);
    }

    let all = await q.order(order).collect();
    all = all.filter((doc) => (doc.roleIds ?? []).includes(where.roleId!));

    let startIdx = 0;
    if (cursor) {
      const cursorIdx = all.findIndex((doc) => doc._id === cursor);
      if (cursorIdx !== -1) {
        startIdx = cursorIdx + 1;
      }
    }
    const slice = all.slice(startIdx, startIdx + numItems + 1);
    const hasMore = slice.length > numItems;
    const page = hasMore ? slice.slice(0, numItems) : slice;
    return {
      page,
      isDone: !hasMore,
      continueCursor: hasMore ? (page[page.length - 1]._id as string) : "",
    };
  },
});
/**
 * Resolve a user's membership by walking the group hierarchy from the
 * requested group up to the root. Returns the first matching membership
 * found, enabling inherited (ancestor-level) access checks.
 *
 * The traversal walks from `groupId` to its `parentGroupId`, then to the
 * parent's parent, and so on, up to `maxDepth` levels (default 32). It
 * stops at the first group where the user has a membership record. Cycle
 * detection prevents infinite loops if the hierarchy is malformed.
 *
 * When `ancestry` is `true`, the response includes a `traversedGroupIds`
 * array showing the full path that was walked (useful for debugging or
 * audit trails).
 *
 * This runs entirely inside the component (no cross-component RPCs per level).
 *
 * @param args.userId - The `Id<"User">` of the user whose membership to resolve.
 * @param args.groupId - The `Id<"Group">` to start the upward traversal from.
 * @param args.maxDepth - Optional maximum number of parent levels to traverse (defaults to 32). Set to `0` to check only the exact group.
 * @param args.ancestry - When `true`, the response includes the `traversedGroupIds` array showing all group IDs visited during the walk.
 * @returns An object with:
 *   - `membership` — the member document at the matched group, or `null` if none was found.
 *   - `matchedGroupId` — the ID of the group where membership was found, or `null`.
 *   - `depth` — how many levels above `groupId` the match was found (0 = direct), or `null` if not found.
 *   - `isDirect` — `true` when `depth === 0`.
 *   - `isInherited` — `true` when `depth > 0`.
 *   - `traversedGroupIds` — (only when `ancestry` is `true`) array of group IDs visited.
 *
 */
export const memberResolve = query({
  args: {
    userId: v.id("User"),
    groupId: v.id("Group"),
    maxDepth: v.optional(v.number()),
    ancestry: v.optional(v.boolean()),
  },
  returns: v.object({
    membership: v.union(vGroupMemberDoc, v.null()),
    matchedGroupId: v.union(v.id("Group"), v.null()),
    depth: v.union(v.number(), v.null()),
    isDirect: v.boolean(),
    isInherited: v.boolean(),
    traversedGroupIds: v.optional(v.array(v.id("Group"))),
  }),
  handler: async (ctx, args) => {
    const maxDepth = Math.max(0, Math.floor(args.maxDepth ?? 32));
    const includeAncestry = args.ancestry ?? false;
    const visited = new Set<string>();
    const traversedGroupIds: Id<"Group">[] = [];
    let currentGroupId: Id<"Group"> | undefined = args.groupId;
    let depth = 0;

    while (currentGroupId !== undefined && depth <= maxDepth) {
      if (visited.has(currentGroupId)) break;
      visited.add(currentGroupId);
      if (includeAncestry) traversedGroupIds.push(currentGroupId);

      const membership = await ctx.db
        .query("GroupMember")
        .withIndex("group_id_user_id", (q) =>
          q.eq("groupId", currentGroupId!).eq("userId", args.userId),
        )
        .unique();

      if (membership !== null) {
        return {
          membership,
          matchedGroupId: currentGroupId,
          depth,
          isDirect: depth === 0,
          isInherited: depth > 0,
          ...(includeAncestry ? { traversedGroupIds } : {}),
        };
      }

      const groupDoc: { parentGroupId?: Id<"Group"> } | null = await ctx.db.get(currentGroupId);
      if (!groupDoc?.parentGroupId) break;
      currentGroupId = groupDoc.parentGroupId;
      depth++;
    }

    return {
      membership: null,
      matchedGroupId: null,
      depth: null,
      isDirect: false,
      isInherited: false,
      ...(includeAncestry ? { traversedGroupIds } : {}),
    };
  },
});

/**
 * Remove a member from a group by permanently deleting the member record.
 *
 * This is a hard delete — the `GroupMember` document is removed from the
 * database entirely. If you need soft-delete semantics, use
 * {@link memberUpdate} to set the `status` field instead.
 *
 * @param args.memberId - The `Id<"GroupMember">` of the member record to delete.
 * @returns `null` on success.
 *
 */
export const memberRemove = mutation({
  args: { memberId: v.id("GroupMember") },
  returns: v.null(),
  handler: async (ctx, { memberId }) => {
    await ctx.db.delete("GroupMember", memberId);
    return null;
  },
});

/**
 * Update a member record's mutable fields such as `roleIds`, `status`, and
 * `extend`.
 *
 * Uses `db.patch` under the hood, so only the fields present in `data` are
 * modified — all other fields on the member document are left unchanged.
 *
 * @param args.memberId - The `Id<"GroupMember">` of the member record to update.
 * @param args.data - A partial object of fields to patch. Supported keys include `roleIds`, `status`, and `extend`.
 * @returns `null` on success.
 *
 */
export const memberUpdate = mutation({
  args: {
    memberId: v.id("GroupMember"),
    data: v.object({
      groupId: v.optional(v.id("Group")),
      userId: v.optional(v.id("User")),
      role: v.optional(v.string()),
      roleIds: v.optional(v.array(v.string())),
      status: v.optional(v.string()),
      extend: v.optional(v.any()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { memberId, data }) => {
    await ctx.db.patch("GroupMember", memberId, data);
    return null;
  },
});

// ============================================================================
// Invites
// ============================================================================
