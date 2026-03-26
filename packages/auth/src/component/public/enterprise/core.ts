import { ConvexError, v } from "convex/values";
import { mutation, query } from "../../functions";
import {
  vEnterpriseDoc,
  vEnterpriseDomainDoc,
  vEnterprisePolicy,
  vEnterpriseStatus,
  vPaginated,
} from "../../model";

/**
 * Create a new enterprise record attached to a root group.
 *
 * Each group may only have one enterprise record. If an enterprise already
 * exists for the given group, a `ENTERPRISE_ALREADY_EXISTS` error is thrown.
 * The enterprise status defaults to `"draft"` when not explicitly provided.
 *
 * @param args.groupId - The ID of the root group that owns this enterprise.
 * @param args.slug - An optional URL-friendly identifier for the enterprise.
 * @param args.name - An optional human-readable display name for the enterprise.
 * @param args.status - The lifecycle status (`"draft"`, `"active"`, or `"disabled"`). Defaults to `"draft"`.
 * @param args.policy - An optional enterprise policy object controlling identity linking, provisioning, and deprovisioning behavior.
 * @param args.config - An optional arbitrary configuration blob for enterprise-specific settings.
 * @param args.extend - An optional arbitrary extension object for custom fields.
 * @returns The ID of the newly created `Enterprise` document.
 *
 * @example
 * ```ts
 * const enterpriseId = await ctx.runMutation(
 *   components.auth.enterprise.enterpriseCreate,
 *   {
 *     groupId: orgGroupId,
 *     slug: "acme-corp",
 *     name: "Acme Corporation",
 *     status: "active",
 *   },
 * );
 * ```
 */
export const enterpriseCreate = mutation({
  args: {
    groupId: v.id("Group"),
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    status: v.optional(vEnterpriseStatus),
    policy: v.optional(vEnterprisePolicy),
    config: v.optional(v.any()),
    extend: v.optional(v.any()),
  },
  returns: v.id("Enterprise"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("Enterprise")
      .withIndex("group_id", (idx) => idx.eq("groupId", args.groupId))
      .first();
    if (existing) {
      throw new ConvexError({
        code: "ENTERPRISE_ALREADY_EXISTS",
        message: "An enterprise record already exists for this group.",
      });
    }
    return await ctx.db.insert("Enterprise", {
      ...args,
      status: args.status ?? "draft",
    });
  },
});

/**
 * Retrieve a single enterprise record by its document ID.
 *
 * Returns the full enterprise document if it exists, or `null` if no
 * enterprise is found with the given ID.
 *
 * @param args.enterpriseId - The document ID of the enterprise to retrieve.
 * @returns The enterprise document, or `null` if not found.
 *
 * @example
 * ```ts
 * const enterprise = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseGet,
 *   { enterpriseId },
 * );
 * if (enterprise) {
 *   console.log(enterprise.name, enterprise.status);
 * }
 * ```
 */
export const enterpriseGet = query({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.union(vEnterpriseDoc, v.null()),
  handler: async (ctx, { enterpriseId }) => {
    return await ctx.db.get("Enterprise", enterpriseId);
  },
});

/**
 * Retrieve an enterprise record by the ID of its owning group.
 *
 * Looks up the enterprise that is linked to the specified group using the
 * `group_id` index. Returns `null` if no enterprise is associated with the group.
 *
 * @param args.groupId - The ID of the root group whose enterprise record to look up.
 * @returns The enterprise document, or `null` if the group has no enterprise.
 *
 * @example
 * ```ts
 * const enterprise = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseGetByGroup,
 *   { groupId: orgGroupId },
 * );
 * ```
 */
export const enterpriseGetByGroup = query({
  args: { groupId: v.id("Group") },
  returns: v.union(vEnterpriseDoc, v.null()),
  handler: async (ctx, { groupId }) => {
    return await ctx.db
      .query("Enterprise")
      .withIndex("group_id", (idx) => idx.eq("groupId", groupId))
      .first();
  },
});

/**
 * Retrieve an enterprise record by one of its linked domain names.
 *
 * Looks up an `EnterpriseDomain` row matching the given domain string, then
 * resolves the parent enterprise. Returns both the enterprise and the matched
 * domain document, or `null` if the domain is not registered or its enterprise
 * no longer exists.
 *
 * @param args.domain - The domain name to search for (e.g. `"acme.com"`).
 * @returns An object containing the `enterprise` and `domain` documents, or `null` if not found.
 *
 * @example
 * ```ts
 * const result = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseGetByDomain,
 *   { domain: "acme.com" },
 * );
 * if (result) {
 *   console.log(result.enterprise.name, result.domain.verifiedAt);
 * }
 * ```
 */
export const enterpriseGetByDomain = query({
  args: { domain: v.string() },
  returns: v.union(
    v.object({
      enterprise: vEnterpriseDoc,
      domain: vEnterpriseDomainDoc,
    }),
    v.null(),
  ),
  handler: async (ctx, { domain }) => {
    const domainRow = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("domain", (idx) => idx.eq("domain", domain))
      .first();
    if (!domainRow) {
      return null;
    }
    const enterprise = await ctx.db.get("Enterprise", domainRow.enterpriseId);
    if (!enterprise) {
      return null;
    }
    return { enterprise, domain: domainRow };
  },
});

/**
 * List enterprise records with optional filtering and cursor-based pagination.
 *
 * Supports filtering by `groupId`, `slug`, and/or `status`. The query selects
 * the most specific index available for the primary filter, then applies
 * remaining predicates as post-filters. Results are ordered by creation time
 * (or the specified field) and paginated using an opaque cursor.
 *
 * @param args.where - Optional filter criteria: `groupId`, `slug`, and/or `status`.
 * @param args.limit - Maximum number of items per page (clamped between 1 and 100, defaults to 50).
 * @param args.cursor - An opaque cursor string returned from a previous call to fetch the next page, or `null` / omitted for the first page.
 * @param args.orderBy - The field to sort results by: `"_creationTime"`, `"name"`, `"slug"`, or `"status"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (defaults to `"desc"`).
 * @returns A paginated result containing `items` (array of enterprise documents) and `nextCursor` (`string | null`).
 *
 * @example
 * ```ts
 * const page = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseList,
 *   {
 *     where: { status: "active" },
 *     limit: 25,
 *     order: "asc",
 *   },
 * );
 * for (const ent of page.items) {
 *   console.log(ent.name);
 * }
 * // Fetch next page:
 * const nextPage = await ctx.runQuery(
 *   components.auth.enterprise.enterpriseList,
 *   { where: { status: "active" }, cursor: page.nextCursor },
 * );
 * ```
 */
export const enterpriseList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        slug: v.optional(v.string()),
        status: v.optional(vEnterpriseStatus),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("slug"),
        v.literal("status"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vEnterpriseDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.groupId !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.slug !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("Enterprise")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("Enterprise");
    }

    if (where.groupId !== undefined && where.slug !== undefined) {
      q = q.filter((f) => f.eq(f.field("slug"), where.slug!));
    }
    if (where.status !== undefined && where.groupId === undefined) {
      // already handled by index in the dedicated branch
    } else if (where.status !== undefined) {
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
 * Partially update (patch) an existing enterprise record.
 *
 * Merges the provided `data` fields into the existing enterprise document.
 * Only the fields present in `data` are changed; all other fields are preserved.
 *
 * @param args.enterpriseId - The document ID of the enterprise to update.
 * @param args.data - An object containing the fields to update (e.g. `{ name, status, policy }`).
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseUpdate,
 *   {
 *     enterpriseId,
 *     data: { status: "active", name: "Acme Corp (Renamed)" },
 *   },
 * );
 * ```
 */
export const enterpriseUpdate = mutation({
  args: { enterpriseId: v.id("Enterprise"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { enterpriseId, data }) => {
    await ctx.db.patch(enterpriseId, data);
    return null;
  },
});

/**
 * Delete an enterprise record and all of its associated child data.
 *
 * This cascading delete removes the enterprise document along with all linked
 * domain records, domain verification records, and enterprise secrets. Callers
 * should ensure that higher-level cleanup (e.g. SCIM identities, webhook
 * endpoints) is handled separately if needed.
 *
 * @param args.enterpriseId - The document ID of the enterprise to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.enterprise.enterpriseDelete,
 *   { enterpriseId },
 * );
 * ```
 */
export const enterpriseDelete = mutation({
  args: { enterpriseId: v.id("Enterprise") },
  returns: v.null(),
  handler: async (ctx, { enterpriseId }) => {
    const domains = await ctx.db
      .query("EnterpriseDomain")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
    for (const domain of domains) {
      const verification = await ctx.db
        .query("EnterpriseDomainVerification")
        .withIndex("domain_id", (idx) => idx.eq("domainId", domain._id))
        .first();
      if (verification) {
        await ctx.db.delete(verification._id);
      }
      await ctx.db.delete(domain._id);
    }
    const secrets = await ctx.db
      .query("EnterpriseSecret")
      .withIndex("enterprise_id", (idx) => idx.eq("enterpriseId", enterpriseId))
      .collect();
    for (const secret of secrets) {
      await ctx.db.delete(secret._id);
    }
    await ctx.db.delete(enterpriseId);
    return null;
  },
});
