import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vEnterpriseScimConfigDoc,
  vEnterpriseScimIdentityDoc,
  vScimResourceType,
  vScimStatus,
} from "../../model";

/**
 * Create or update the SCIM provisioning configuration for an enterprise.
 *
 * If a SCIM config already exists for the given enterprise, all fields are
 * patched in place (useful for rotating the bearer token). Otherwise a new
 * config document is created. Only one SCIM config is allowed per enterprise.
 *
 * @param args.enterpriseId - The ID of the enterprise to configure SCIM for.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.status - The SCIM config lifecycle status: `"draft"`, `"active"`, or `"disabled"`.
 * @param args.basePath - The base URL path for the SCIM endpoint (e.g. `"/scim/v2"`).
 * @param args.tokenHash - A hash of the bearer token used to authenticate SCIM requests.
 * @param args.lastRotatedAt - An optional epoch timestamp (ms) recording when the token was last rotated.
 * @param args.extend - An optional arbitrary extension object for custom SCIM settings.
 * @returns The ID of the created or updated `EnterpriseScimConfig` document.
 *
 * @example
 * ```ts
 * const configId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseScimConfigUpsert,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     status: "active",
 *     basePath: "/scim/v2",
 *     tokenHash: "sha256:abc123...",
 *     lastRotatedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const enterpriseScimConfigUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    status: vScimStatus,
    basePath: v.string(),
    tokenHash: v.string(),
    lastRotatedAt: v.optional(v.number()),
    extend: v.optional(v.any()),
  },
  returns: v.id("EnterpriseScimConfig"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("enterprise_id", (idx) =>
        idx.eq("enterpriseId", args.enterpriseId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseScimConfig", args);
  },
});

/**
 * Retrieve the SCIM configuration for a specific enterprise.
 *
 * Looks up the SCIM config document by enterprise ID using the
 * `enterprise_id` index. Returns `null` if SCIM has not been configured.
 *
 * @param args.enterpriseId - The ID of the enterprise whose SCIM config to retrieve.
 * @returns The SCIM configuration document, or `null` if not configured.
 *
 * @example
 * ```ts
 * const config = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimConfigGetByEnterprise,
 *   { enterpriseId },
 * );
 * if (config) {
 *   console.log(config.status, config.basePath);
 * }
 * ```
 */
export const enterpriseScimConfigGetByEnterprise = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.union(vEnterpriseScimConfigDoc, v.null()),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .first();
  },
});

/**
 * Look up a SCIM configuration by its bearer token hash.
 *
 * Used during SCIM request authentication to resolve which enterprise a
 * given bearer token belongs to. Returns `null` if no config matches.
 *
 * @param args.tokenHash - The hash of the bearer token from the incoming SCIM request.
 * @returns The matching SCIM configuration document, or `null` if not found.
 *
 * @example
 * ```ts
 * const config = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimConfigGetByTokenHash,
 *   { tokenHash: "sha256:abc123..." },
 * );
 * if (config) {
 *   console.log("Authenticated enterprise:", config.enterpriseId);
 * }
 * ```
 */
export const enterpriseScimConfigGetByTokenHash = query({
  args: { tokenHash: v.string() },
  returns: v.union(vEnterpriseScimConfigDoc, v.null()),
  handler: async (ctx, { tokenHash }) => {
    return await ctx.db
      .query("EnterpriseScimConfig")
      .withIndex("token_hash", (idx) => idx.eq("tokenHash", tokenHash))
      .first();
  },
});

/**
 * Retrieve a SCIM identity by enterprise, resource type, and external ID.
 *
 * Looks up a SCIM-provisioned identity using the composite index on
 * `(enterpriseId, resourceType, externalId)`. This is the primary lookup
 * used when processing incoming SCIM user or group operations.
 *
 * @param args.enterpriseId - The ID of the enterprise that owns the SCIM identity.
 * @param args.resourceType - The SCIM resource type: `"user"` or `"group"`.
 * @param args.externalId - The external identifier assigned by the identity provider.
 * @returns The SCIM identity document, or `null` if not found.
 *
 * @example
 * ```ts
 * const identity = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimIdentityGet,
 *   {
 *     enterpriseId,
 *     resourceType: "user",
 *     externalId: "okta-user-abc123",
 *   },
 * );
 * ```
 */
export const enterpriseScimIdentityGet = query({
  args: {
    enterpriseId: v.id("Enterprise"),
    resourceType: vScimResourceType,
    externalId: v.string(),
  },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_resource_type_external_id", (idx) =>
        idx
          .eq("enterpriseId", args.enterpriseId)
          .eq("resourceType", args.resourceType)
          .eq("externalId", args.externalId),
      )
      .first();
  },
});

/**
 * Retrieve the SCIM identity linked to a specific user.
 *
 * Looks up the first SCIM identity document associated with the given user ID
 * via the `user_id` index. Useful for checking whether a user was provisioned
 * through SCIM.
 *
 * @param args.userId - The document ID of the user whose SCIM identity to retrieve.
 * @returns The SCIM identity document, or `null` if the user has no SCIM identity.
 *
 * @example
 * ```ts
 * const scimIdentity = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimIdentityGetByUser,
 *   { userId },
 * );
 * if (scimIdentity) {
 *   console.log("User provisioned via SCIM:", scimIdentity.externalId);
 * }
 * ```
 */
export const enterpriseScimIdentityGetByUser = query({
  args: { userId: v.id("User") },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("user_id", (idx) => idx.eq("userId", userId))
      .first();
  },
});

/**
 * Retrieve the SCIM identity for a specific user within a specific enterprise.
 *
 * Uses the composite `(enterpriseId, userId)` index to find the SCIM identity
 * that links a user to a particular enterprise. This is useful when a user may
 * belong to multiple enterprises.
 *
 * @param args.enterpriseId - The ID of the enterprise to scope the lookup to.
 * @param args.userId - The document ID of the user.
 * @returns The SCIM identity document, or `null` if not found.
 *
 * @example
 * ```ts
 * const identity = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimIdentityGetByEnterpriseAndUser,
 *   { enterpriseId, userId },
 * );
 * ```
 */
export const enterpriseScimIdentityGetByEnterpriseAndUser = query({
  args: {
    enterpriseId: v.id("Enterprise"),
    userId: v.id("User"),
  },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { enterpriseId, userId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_user_id", (idx) =>
        idx.eq("enterpriseId", enterpriseId).eq("userId", userId),
      )
      .first();
  },
});

/**
 * Retrieve the SCIM identity that is mapped to a specific group.
 *
 * Looks up a SCIM identity by its `mappedGroupId` field. This is used when
 * a SCIM group resource has been mapped to an internal group, and you need
 * to find the corresponding SCIM identity record.
 *
 * @param args.mappedGroupId - The document ID of the internal group that a SCIM group is mapped to.
 * @returns The SCIM identity document, or `null` if no mapping exists.
 *
 * @example
 * ```ts
 * const scimGroup = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimIdentityGetByMappedGroup,
 *   { mappedGroupId: teamGroupId },
 * );
 * if (scimGroup) {
 *   console.log("SCIM external group ID:", scimGroup.externalId);
 * }
 * ```
 */
export const enterpriseScimIdentityGetByMappedGroup = query({
  args: { mappedGroupId: v.id("Group") },
  returns: v.union(vEnterpriseScimIdentityDoc, v.null()),
  handler: async (ctx, { mappedGroupId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("mapped_group_id", (idx) =>
        idx.eq("mappedGroupId", mappedGroupId),
      )
      .first();
  },
});

/**
 * List all SCIM identities belonging to a specific enterprise.
 *
 * Returns all `EnterpriseScimIdentity` documents for the given enterprise,
 * including both user and group resource types. Useful for displaying all
 * SCIM-provisioned resources or for bulk operations.
 *
 * @param args.enterpriseId - The ID of the enterprise whose SCIM identities to list.
 * @returns An array of SCIM identity documents.
 *
 * @example
 * ```ts
 * const identities = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseScimIdentityListByEnterprise,
 *   { enterpriseId },
 * );
 * const users = identities.filter((i) => i.resourceType === "user");
 * const groups = identities.filter((i) => i.resourceType === "group");
 * ```
 */
export const enterpriseScimIdentityListByEnterprise = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.array(vEnterpriseScimIdentityDoc),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
  },
});

/**
 * Create or update a SCIM-provisioned identity record.
 *
 * If a SCIM identity with the same `(enterpriseId, resourceType, externalId)`
 * already exists, its fields are patched in place. Otherwise a new record is
 * created. This is the core upsert used by the SCIM provisioning handler to
 * sync users and groups from external identity providers.
 *
 * @param args.enterpriseId - The ID of the enterprise the identity belongs to.
 * @param args.groupId - The ID of the root group that owns the enterprise.
 * @param args.resourceType - The SCIM resource type: `"user"` or `"group"`.
 * @param args.externalId - The external identifier assigned by the identity provider.
 * @param args.userId - An optional link to the internal user document (for user resources).
 * @param args.mappedGroupId - An optional link to an internal group document (for group resources).
 * @param args.lastProvisionedAt - An optional epoch timestamp (ms) of the last sync.
 * @param args.active - An optional flag indicating whether the identity is active.
 * @param args.raw - An optional raw SCIM payload stored for debugging or re-processing.
 * @returns The ID of the created or updated `EnterpriseScimIdentity` document.
 *
 * @example
 * ```ts
 * const identityId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseScimIdentityUpsert,
 *   {
 *     enterpriseId,
 *     groupId: orgGroupId,
 *     resourceType: "user",
 *     externalId: "okta-user-abc123",
 *     userId,
 *     active: true,
 *     lastProvisionedAt: Date.now(),
 *     raw: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "jane@acme.com" },
 *   },
 * );
 * ```
 */
export const enterpriseScimIdentityUpsert = mutation({
  args: {
    enterpriseId: v.id("Enterprise"),
    groupId: v.id("Group"),
    resourceType: vScimResourceType,
    externalId: v.string(),
    userId: v.optional(v.id("User")),
    mappedGroupId: v.optional(v.id("Group")),
    lastProvisionedAt: v.optional(v.number()),
    active: v.optional(v.boolean()),
    raw: v.optional(v.any()),
  },
  returns: v.id("EnterpriseScimIdentity"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("EnterpriseScimIdentity")
      .withIndex("enterprise_id_resource_type_external_id", (idx) =>
        idx
          .eq("enterpriseId", args.enterpriseId)
          .eq("resourceType", args.resourceType)
          .eq("externalId", args.externalId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("EnterpriseScimIdentity", args);
  },
});

/**
 * Permanently delete a SCIM identity record.
 *
 * Removes the `EnterpriseScimIdentity` document. This is typically called
 * when a SCIM DELETE request is received for a user or group resource.
 *
 * @param args.identityId - The document ID of the SCIM identity to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseScimIdentityDelete,
 *   { identityId: scimIdentity._id },
 * );
 * ```
 */
export const enterpriseScimIdentityDelete = mutation({
  args: { identityId: v.id("EnterpriseScimIdentity") },
  returns: v.null(),
  handler: async (ctx, { identityId }) => {
    await ctx.db.delete(identityId);
    return null;
  },
});
