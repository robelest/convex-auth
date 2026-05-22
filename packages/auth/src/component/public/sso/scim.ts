import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vGroupConnectionScimConfigDoc,
  vGroupConnectionScimIdentityDoc,
  vScimResourceType,
  vScimStatus,
} from "../../model";

/**
 * Create or update the SCIM provisioning configuration for an group.sso.
 *
 * If a SCIM config already exists for the given group connection, all fields are
 * patched in place (useful for rotating the bearer token). Otherwise a new
 * config document is created. Only one SCIM config is allowed per group.sso.
 *
 * @param args.connectionId - The ID of the group connection to configure SCIM for.
 * @param args.groupId - The ID of the root group that owns the group.sso.
 * @param args.status - The SCIM config lifecycle status: `"draft"`, `"active"`, or `"disabled"`.
 * @param args.basePath - The base URL path for the SCIM endpoint (e.g. `"/scim/v2"`).
 * @param args.tokenHash - A hash of the bearer token used to authenticate SCIM requests.
 * @param args.lastRotatedAt - An optional epoch timestamp (ms) recording when the token was last rotated.
 * @param args.extend - An optional arbitrary extension object for custom SCIM settings.
 * @returns The ID of the created or updated `GroupConnectionScimConfig` document.
 *
 */
export const groupConnectionScimConfigUpsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    status: vScimStatus,
    basePath: v.string(),
    tokenHash: v.string(),
    lastRotatedAt: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupConnectionScimConfig"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("GroupConnectionScimConfig")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", args.connectionId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionScimConfig", args);
  },
});

/**
 * Read a SCIM configuration by identity.
 *
 * Accepts exactly one selector:
 * - `connectionId` — the SCIM config for a group connection, via the
 *   `group_connection_id` index.
 * - `tokenHash` — resolve which connection a bearer token belongs to,
 *   via the `token_hash` index (used during SCIM request auth).
 *
 * @param connectionId - Optional `_id` of the `GroupConnection`.
 * @param tokenHash - Optional bearer-token hash from an incoming request.
 * @returns The matching SCIM configuration document, or `null`.
 *
 */
export const groupConnectionScimConfigGet = query({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    tokenHash: v.optional(v.string()),
  },
  returns: v.union(vGroupConnectionScimConfigDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.tokenHash !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimConfig")
        .withIndex("token_hash", (idx) => idx.eq("tokenHash", args.tokenHash!))
        .first();
    }
    if (args.connectionId === undefined) return null;
    return await ctx.db
      .query("GroupConnectionScimConfig")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", args.connectionId!))
      .first();
  },
});

/**
 * Read a single SCIM identity by identity.
 *
 * Accepts exactly one selector (checked most-specific first):
 * - `connectionId` + `resourceType` + `externalId` — the composite
 *   `(connectionId, resourceType, externalId)` index. Primary lookup for
 *   incoming SCIM user/group operations.
 * - `connectionId` + `userId` — the `(connectionId, userId)` index, for
 *   a user's identity scoped to one connection.
 * - `userId` — the first identity for a user, via the `user_id` index.
 * - `mappedGroupId` — the identity mapped to an internal group, via the
 *   `mapped_group_id` index.
 * - `connectionId` + `userIds` — batch: resolve each user's identity
 *   under the connection, returning `(Doc | null)[]` aligned to
 *   `userIds` order (duplicates de-duplicated internally). One round-trip
 *   for large SCIM syncs instead of a per-user fan-out.
 *
 * @param connectionId - Optional `_id` of the `GroupConnection`.
 * @param resourceType - Optional SCIM resource type (`"user"` | `"group"`).
 * @param externalId - Optional external identifier from the IdP.
 * @param userId - Optional `_id` of the linked `User`.
 * @param userIds - Optional `_id[]` for a batched per-user lookup.
 * @param mappedGroupId - Optional `_id` of the mapped internal `Group`.
 * @returns The matching SCIM identity document or `null`; for `userIds`,
 *   an aligned `(Doc | null)[]`.
 *
 */
export const groupConnectionScimIdentityGet = query({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    resourceType: v.optional(vScimResourceType),
    externalId: v.optional(v.string()),
    userId: v.optional(v.id("User")),
    userIds: v.optional(v.array(v.id("User"))),
    mappedGroupId: v.optional(v.id("Group")),
  },
  returns: v.union(
    vGroupConnectionScimIdentityDoc,
    v.null(),
    v.array(v.union(vGroupConnectionScimIdentityDoc, v.null())),
  ),
  handler: async (ctx, args) => {
    if (args.connectionId !== undefined && args.userIds !== undefined) {
      const userIds = args.userIds;
      if (userIds.length === 0) return [];
      const unique = Array.from(new Set(userIds));
      const docs = await Promise.all(
        unique.map((userId) =>
          ctx.db
            .query("GroupConnectionScimIdentity")
            .withIndex("group_connection_id_user_id", (idx) =>
              idx.eq("connectionId", args.connectionId!).eq("userId", userId),
            )
            .first(),
        ),
      );
      const byUserId = new Map(unique.map((id, i) => [id, docs[i] ?? null]));
      return userIds.map((userId) => byUserId.get(userId) ?? null);
    }
    if (
      args.connectionId !== undefined &&
      args.resourceType !== undefined &&
      args.externalId !== undefined
    ) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("group_connection_id_resource_type_external_id", (idx) =>
          idx
            .eq("connectionId", args.connectionId!)
            .eq("resourceType", args.resourceType!)
            .eq("externalId", args.externalId!),
        )
        .first();
    }
    if (args.connectionId !== undefined && args.userId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("group_connection_id_user_id", (idx) =>
          idx.eq("connectionId", args.connectionId!).eq("userId", args.userId!),
        )
        .first();
    }
    if (args.userId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("user_id", (idx) => idx.eq("userId", args.userId!))
        .first();
    }
    if (args.mappedGroupId !== undefined) {
      return await ctx.db
        .query("GroupConnectionScimIdentity")
        .withIndex("mapped_group_id", (idx) => idx.eq("mappedGroupId", args.mappedGroupId!))
        .first();
    }
    return null;
  },
});

/**
 * List all SCIM identities belonging to a specific group.sso.
 *
 * Returns all `GroupConnectionScimIdentity` documents for the given group connection,
 * including both user and group resource types. Useful for displaying all
 * SCIM-provisioned resources or for bulk operations.
 *
 * @param args.connectionId - The ID of the group connection whose SCIM identities to list.
 * @returns An array of SCIM identity documents.
 *
 */
export const groupConnectionScimIdentityListByGroupConnection = query({
  args: { connectionId: v.id("GroupConnection") },
  returns: v.array(vGroupConnectionScimIdentityDoc),
  handler: async (ctx, { connectionId }) => {
    return await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("group_connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();
  },
});

/**
 * Create or update a SCIM-provisioned identity record.
 *
 * If a SCIM identity with the same `(connectionId, resourceType, externalId)`
 * already exists, its fields are patched in place. Otherwise a new record is
 * created. This is the core upsert used by the SCIM provisioning handler to
 * sync users and groups from external identity providers.
 *
 * @param args.connectionId - The ID of the group connection the identity belongs to.
 * @param args.groupId - The ID of the root group that owns the group.sso.
 * @param args.resourceType - The SCIM resource type: `"user"` or `"group"`.
 * @param args.externalId - The external identifier assigned by the identity provider.
 * @param args.userId - An optional link to the internal user document (for user resources).
 * @param args.mappedGroupId - An optional link to an internal group document (for group resources).
 * @param args.lastProvisionedAt - An optional epoch timestamp (ms) of the last sync.
 * @param args.active - An optional flag indicating whether the identity is active.
 * @param args.raw - An optional raw SCIM payload stored for debugging or re-processing.
 * @returns The ID of the created or updated `GroupConnectionScimIdentity` document.
 *
 */
export const groupConnectionScimIdentityUpsert = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    groupId: v.id("Group"),
    resourceType: vScimResourceType,
    externalId: v.string(),
    userId: v.optional(v.id("User")),
    mappedGroupId: v.optional(v.id("Group")),
    lastProvisionedAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
    raw: v.optional(v.any()),
  },
  returns: v.id("GroupConnectionScimIdentity"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("GroupConnectionScimIdentity")
      .withIndex("group_connection_id_resource_type_external_id", (idx) =>
        idx
          .eq("connectionId", args.connectionId)
          .eq("resourceType", args.resourceType)
          .eq("externalId", args.externalId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("GroupConnectionScimIdentity", args);
  },
});

/**
 * Permanently delete a SCIM identity record.
 *
 * Removes the `GroupConnectionScimIdentity` document. This is typically called
 * when a SCIM DELETE request is received for a user or group resource.
 *
 * @param args.identityId - The document ID of the SCIM identity to delete.
 * @returns `null` on success.
 *
 */
export const groupConnectionScimIdentityDelete = mutation({
  args: { identityId: v.id("GroupConnectionScimIdentity") },
  returns: v.null(),
  handler: async (ctx, { identityId }) => {
    await ctx.db.delete(identityId);
    return null;
  },
});
