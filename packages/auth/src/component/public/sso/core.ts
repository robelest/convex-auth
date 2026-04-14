import { v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vGroupConnectionDoc,
  vGroupConnectionDomainDoc,
  vGroupConnectionProtocol,
  vGroupConnectionStatus,
  vPaginated,
} from "../../model";

/**
 * Create a new group connection record attached to a root group.
 *
 * Creates a new group SSO connection attached to a root group.
 * The group connection status defaults to `"draft"` when not explicitly provided.
 *
 * @param args.groupId - The ID of the root group that owns this group.sso.
 * @param args.slug - An optional URL-friendly identifier for the group.sso.
 * @param args.name - An optional human-readable display name for the group.sso.
 * @param args.protocol - The protocol for this group connection (`"oidc"` or `"saml"`).
 * @param args.status - The lifecycle status (`"draft"`, `"active"`, or `"disabled"`). Defaults to `"draft"`.
 * @param args.config - An optional arbitrary configuration blob for group connection-specific settings.
 * @param args.extend - An optional arbitrary extension object for custom fields.
 * @returns The ID of the newly created `Group Connection` document.
 *
 * @example
 * ```ts
 * const connectionId = await ctx.runMutation(
 *   components.auth.group.sso.groupConnectionCreate,
 *   {
 *     groupId: orgGroupId,
 *     slug: "acme-corp",
 *     name: "Acme Corporation",
 *     status: "active",
 *   },
 * );
 * ```
 */
export const groupConnectionCreate = mutation({
  args: {
    groupId: v.id("Group"),
    slug: v.optional(v.string()),
    name: v.optional(v.string()),
    protocol: vGroupConnectionProtocol,
    status: v.optional(vGroupConnectionStatus),
    config: v.optional(v.any()),
    extend: v.optional(v.any()),
  },
  returns: v.id("GroupConnection"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("GroupConnection", {
      ...args,
      status: args.status ?? "draft",
    });
  },
});

/**
 * Retrieve a single group connection record by its document ID.
 *
 * Returns the full group connection document if it exists, or `null` if no
 * group connection is found with the given ID.
 *
 * @param args.connectionId - The document ID of the group connection to retrieve.
 * @returns The group connection document, or `null` if not found.
 *
 * @example
 * ```ts
 * const connection = await ctx.runQuery(
 *   components.auth.group.sso.groupConnectionGet,
 *   { connectionId },
 * );
 * if (connection) {
 *   console.log(group.sso.name, group.sso.status);
 * }
 * ```
 */
export const groupConnectionGet = query({
  args: { connectionId: v.id("GroupConnection") },
  returns: v.union(vGroupConnectionDoc, v.null()),
  handler: async (ctx, { connectionId }) => {
    return await ctx.db.get("GroupConnection", connectionId);
  },
});

/**
 * Retrieve an group connection record by one of its linked domain names.
 *
 * Looks up a `GroupConnectionDomain` row matching the given domain string, then
 * resolves the parent group.sso. Returns both the group connection and the matched
 * domain document, or `null` if the domain is not registered or its group connection
 * no longer exists.
 *
 * @param args.domain - The domain name to search for (e.g. `"acme.com"`).
 * @returns An object containing the `group connection` and `domain` documents, or `null` if not found.
 *
 * @example
 * ```ts
 * const result = await ctx.runQuery(
 *   components.auth.group.sso.groupConnectionGetByDomain,
 *   { domain: "acme.com" },
 * );
 * if (result) {
 *   console.log(result.connection.name, result.domain.verifiedAt);
 * }
 * ```
 */
export const groupConnectionGetByDomain = query({
  args: { domain: v.string() },
  returns: v.union(
    v.object({
      connection: vGroupConnectionDoc,
      domain: vGroupConnectionDomainDoc,
    }),
    v.null(),
  ),
  handler: async (ctx, { domain }) => {
    const domainRow = await ctx.db
      .query("GroupConnectionDomain")
      .withIndex("domain", (idx) => idx.eq("domain", domain))
      .first();
    if (!domainRow) {
      return null;
    }
    const connection = await ctx.db.get(
      "GroupConnection",
      domainRow.connectionId,
    );
    if (!connection) {
      return null;
    }
    return { connection, domain: domainRow };
  },
});

/**
 * List group connection records with optional filtering and cursor-based pagination.
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
 * @returns A paginated result containing `items` (array of group connection documents) and `nextCursor` (`string | null`).
 *
 * @example
 * ```ts
 * const page = await ctx.runQuery(
 *   components.auth.group.sso.groupConnectionList,
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
 *   components.auth.group.sso.groupConnectionList,
 *   { where: { status: "active" }, cursor: page.nextCursor },
 * );
 * ```
 */
export const groupConnectionList = query({
  args: {
    where: v.optional(
      v.object({
        groupId: v.optional(v.id("Group")),
        slug: v.optional(v.string()),
        status: v.optional(vGroupConnectionStatus),
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
  returns: vPaginated(vGroupConnectionDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.slug !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("GroupConnection");
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
 * Partially update (patch) an existing group connection record.
 *
 * Merges the provided `data` fields into the existing group connection document.
 * Only the fields present in `data` are changed; all other fields are preserved.
 *
 * @param args.connectionId - The document ID of the group connection to update.
 * @param args.data - An object containing the fields to update (e.g. `{ name, status, policy }`).
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.group.sso.groupConnectionUpdate,
 *   {
 *     connectionId,
 *     data: { status: "active", name: "Acme Corp (Renamed)" },
 *   },
 * );
 * ```
 */
export const groupConnectionUpdate = mutation({
  args: { connectionId: v.id("GroupConnection"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { connectionId, data }) => {
    await ctx.db.patch(connectionId, data);
    return null;
  },
});

/**
 * Delete an group connection record and all of its associated child data.
 *
 * This cascading delete removes the group connection document along with all linked
 * domain records, domain verification records, and group connection secrets. Callers
 * should ensure that higher-level cleanup (e.g. SCIM identities, webhook
 * endpoints) is handled separately if needed.
 *
 * @param args.connectionId - The document ID of the group connection to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.group.sso.groupConnectionDelete,
 *   { connectionId },
 * );
 * ```
 */
export const groupConnectionDelete = mutation({
  args: { connectionId: v.id("GroupConnection") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const domains = await ctx.db
      .query("GroupConnectionDomain")
      .withIndex("connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();
    for (const domain of domains) {
      const verification = await ctx.db
        .query("GroupConnectionDomainVerification")
        .withIndex("domain_id", (idx) => idx.eq("domainId", domain._id))
        .first();
      if (verification) {
        await ctx.db.delete(verification._id);
      }
      await ctx.db.delete(domain._id);
    }
    const secrets = await ctx.db
      .query("GroupConnectionSecret")
      .withIndex("connection_id", (idx) => idx.eq("connectionId", connectionId))
      .collect();
    for (const secret of secrets) {
      await ctx.db.delete(secret._id);
    }
    await ctx.db.delete(connectionId);
    return null;
  },
});
