import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { mutation, query } from "../../functions";
import { vGroupDoc, vPaginated, vTag } from "../../model";

type TagPair = { key: string; value: string };

function normalizeTag(tag: TagPair): TagPair {
  return {
    key: tag.key.trim().toLowerCase(),
    value: tag.value.trim().toLowerCase(),
  };
}

function normalizeTags(tags: TagPair[]): TagPair[] {
  const seen = new Set<string>();
  const result: TagPair[] = [];
  for (const raw of tags) {
    const t = normalizeTag(raw);
    const composite = `${t.key}\0${t.value}`;
    if (!seen.has(composite)) {
      seen.add(composite);
      result.push(t);
    }
  }
  return result;
}
/**
 * Create a new group. Groups are hierarchical — set `parentGroupId` to nest
 * under an existing group, or omit it to create a root-level group.
 *
 * Root groups self-reference their own ID as `rootGroupId`. Child groups
 * inherit `rootGroupId` from their parent chain. Tags are normalized
 * (trimmed and lowercased) and deduplicated before storage, and companion
 * `GroupTag` rows are created for indexed lookups.
 *
 * @param args.name - The display name for the group.
 * @param args.slug - An optional URL-friendly identifier for the group (e.g. `"engineering"`).
 * @param args.type - An optional application-defined group type (e.g. `"organization"`, `"team"`).
 * @param args.parentGroupId - The ID of an existing group to nest under. Omit to create a root-level group.
 * @param args.tags - An optional array of `{ key, value }` tag pairs to attach to the group for filtering.
 * @param args.extend - An optional arbitrary payload for application-specific metadata.
 * @returns The `Id<"Group">` of the newly created group document.
 *
 * @example
 * ```ts
 * const groupId = await ctx.runMutation(components.auth.groups.groupCreate, {
 *   name: "Acme Corp",
 *   slug: "acme-corp",
 *   type: "organization",
 *   tags: [{ key: "plan", value: "enterprise" }],
 * });
 * ```
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
    const isRoot = !args.parentGroupId;
    // Compute rootGroupId: root groups self-reference, children inherit from parent
    let rootGroupId: Id<"Group"> | undefined;
    if (!isRoot && args.parentGroupId) {
      const parent = await ctx.db.get(args.parentGroupId);
      rootGroupId = parent?.rootGroupId ?? args.parentGroupId;
    }
    const groupId = await ctx.db.insert("Group", {
      ...rest,
      tags: normalizedTags,
      isRoot,
      rootGroupId: isRoot ? undefined : rootGroupId,
    });
    // Self-reference for root groups (need the ID after insert)
    if (isRoot) {
      await ctx.db.patch(groupId, { rootGroupId: groupId });
    }
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

/**
 * Retrieve a group by its document ID.
 *
 * Performs a direct lookup in the `Group` table and returns the full group
 * document, or `null` if no group exists with the given ID.
 *
 * @param args.groupId - The `Id<"Group">` of the group to retrieve.
 * @returns The group document (including `name`, `slug`, `type`, `tags`, hierarchy fields, etc.) or `null` if not found.
 *
 * @example
 * ```ts
 * const group = await ctx.runQuery(components.auth.groups.groupGet, {
 *   groupId: existingGroupId,
 * });
 * if (group !== null) {
 *   console.log(group.name, group.slug);
 * }
 * ```
 */
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
 * The query engine selects the best database index based on the combination
 * of filter fields provided. Tag filters (`tagsAll`, `tagsAny`) are resolved
 * via the `GroupTag` companion table and intersected/unioned with index results.
 *
 * @param args.where - Optional filter criteria for narrowing results.
 * @param args.where.slug - Match groups with this exact slug.
 * @param args.where.type - Match groups with this exact type.
 * @param args.where.parentGroupId - Match groups that are direct children of the specified parent group.
 * @param args.where.name - Match groups with this exact name.
 * @param args.where.isRoot - When `true`, return only root-level groups; when `false`, only child groups.
 * @param args.where.tagsAll - An array of `{ key, value }` pairs; only groups that have **all** of these tags are returned.
 * @param args.where.tagsAny - An array of `{ key, value }` pairs; groups that have **at least one** of these tags are returned.
 * @param args.limit - Maximum number of items per page (clamped to 1..100, defaults to 50).
 * @param args.cursor - An opaque cursor string from a previous response's `nextCursor` to fetch the next page, or `null` to start from the beginning.
 * @param args.orderBy - The field to sort by: `"_creationTime"`, `"name"`, `"slug"`, or `"type"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (defaults to `"desc"`).
 * @returns An object `{ items, nextCursor }` where `items` is an array of group documents and `nextCursor` is `null` when there are no more pages.
 *
 * @example
 * ```ts
 * const { items, nextCursor } = await ctx.runQuery(
 *   components.auth.groups.groupList,
 *   {
 *     where: { type: "team", isRoot: false },
 *     limit: 20,
 *     order: "asc",
 *   },
 * );
 * ```
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
    } else if (where.isRoot !== undefined) {
      q = ctx.db
        .query("Group")
        .withIndex("is_root", (idx) => idx.eq("isRoot", where.isRoot!));
    } else {
      q = ctx.db.query("Group");
    }

    // Apply remaining non-tag filters not covered by index
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    // isRoot filter when not already used as primary index
    if (
      where.isRoot !== undefined &&
      where.parentGroupId === undefined &&
      (where.type !== undefined || where.slug !== undefined)
    ) {
      q = q.filter((f) => f.eq(f.field("isRoot"), where.isRoot!));
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

/**
 * Update a group's mutable fields such as `name`, `slug`, `tags`, `extend`,
 * and `parentGroupId`.
 *
 * When `parentGroupId` is changed the mutation automatically recomputes
 * `isRoot` and `rootGroupId` for the target group **and** cascades the new
 * `rootGroupId` to all descendant groups. When `tags` are provided they are
 * normalized, deduplicated, and the companion `GroupTag` rows are fully
 * replaced (delete-then-insert).
 *
 * @param args.groupId - The `Id<"Group">` of the group to update.
 * @param args.data - A partial object of fields to patch. Supported keys include `name`, `slug`, `type`, `parentGroupId`, `tags`, and `extend`.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(components.auth.groups.groupUpdate, {
 *   groupId: existingGroupId,
 *   data: {
 *     name: "Acme Corp (renamed)",
 *     tags: [{ key: "plan", value: "pro" }],
 *   },
 * });
 * ```
 */
export const groupUpdate = mutation({
  args: { groupId: v.id("Group"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { groupId, data }) => {
    // If parentGroupId is changing, recompute rootGroupId + isRoot for this group and descendants
    if (data.parentGroupId !== undefined) {
      const oldGroup = await ctx.db.get("Group", groupId);
      const oldRootGroupId = oldGroup?.rootGroupId;
      const newParentGroupId = data.parentGroupId as Id<"Group"> | undefined;
      const newIsRoot = !newParentGroupId;
      let newRootGroupId: Id<"Group">;
      if (newIsRoot) {
        newRootGroupId = groupId;
      } else {
        const parent = await ctx.db.get("Group", newParentGroupId!);
        newRootGroupId = parent?.rootGroupId ?? newParentGroupId!;
      }
      data.isRoot = newIsRoot;
      data.rootGroupId = newRootGroupId;
      // Cascade to descendants if rootGroupId changed
      if (oldRootGroupId && oldRootGroupId !== newRootGroupId) {
        const descendants = await ctx.db
          .query("Group")
          .withIndex("root_group_id", (q) =>
            q.eq("rootGroupId", oldRootGroupId),
          )
          .collect();
        for (const desc of descendants) {
          if (desc._id !== groupId) {
            await ctx.db.patch("Group", desc._id, {
              rootGroupId: newRootGroupId,
            });
          }
        }
      }
    }
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
 * - All companion `GroupTag` rows for this group and its descendants
 *
 * The deletion walks the group tree depth-first, removing leaves before
 * parents, so referential integrity is maintained throughout.
 *
 * @param args.groupId - The `Id<"Group">` of the group to delete. All children are deleted recursively.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // Delete an organization and everything nested under it
 * await ctx.runMutation(components.auth.groups.groupDelete, {
 *   groupId: organizationGroupId,
 * });
 * ```
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
