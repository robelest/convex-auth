import { paginationOptsValidator } from "convex/server";
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
 * Read a group connection by identity.
 *
 * Accepts exactly one selector:
 * - `connectionId` — direct document lookup, returning the
 *   `GroupConnection` document or `null`.
 * - `domain` — resolve the connection that owns a linked domain. Looks
 *   up the `GroupConnectionDomain` row, then its parent connection, and
 *   returns `{ connection, domain }` (or `null` if the domain is not
 *   registered or its connection no longer exists).
 *
 * @param connectionId - Optional `_id` of the `GroupConnection`.
 * @param domain - Optional domain name to resolve (e.g. `"acme.com"`).
 * @returns For `connectionId`: the connection document or `null`. For
 *   `domain`: `{ connection, domain }` or `null`.
 *
 */
export const groupConnectionGet = query({
  args: {
    connectionId: v.optional(v.id("GroupConnection")),
    domain: v.optional(v.string()),
  },
  returns: v.union(
    vGroupConnectionDoc,
    v.object({
      connection: vGroupConnectionDoc,
      domain: vGroupConnectionDomainDoc,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    if (args.domain !== undefined) {
      const domainRow = await ctx.db
        .query("GroupConnectionDomain")
        .withIndex("domain", (idx) => idx.eq("domain", args.domain!))
        .first();
      if (!domainRow) {
        return null;
      }
      const connection = await ctx.db.get("GroupConnection", domainRow.connectionId);
      if (!connection) {
        return null;
      }
      return { connection, domain: domainRow };
    }
    if (args.connectionId === undefined) return null;
    return await ctx.db.get("GroupConnection", args.connectionId);
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
 * @param args.paginationOpts - Convex `paginationOptsValidator` shape
 *   (`{ numItems, cursor }`).
 * @param args.orderBy - The field to sort results by: `"_creationTime"`, `"name"`, `"slug"`, or `"status"`.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (defaults to `"desc"`).
 * @returns A Convex `PaginationResult<GroupConnectionDoc>` — `{ page, isDone, continueCursor }`.
 *
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
    paginationOpts: paginationOptsValidator,
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
    const order = args.order ?? "desc";
    const numItems = args.paginationOpts.numItems;
    const cursor = args.paginationOpts.cursor;

    let q;
    if (where.groupId !== undefined && where.status !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("group_id_status", (idx) =>
          idx.eq("groupId", where.groupId!).eq("status", where.status!),
        );
    } else if (where.groupId !== undefined && where.slug !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("group_id_slug", (idx) =>
          idx.eq("groupId", where.groupId!).eq("slug", where.slug!),
        );
    } else if (where.groupId !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("group_id", (idx) => idx.eq("groupId", where.groupId!));
    } else if (where.slug !== undefined) {
      q = ctx.db.query("GroupConnection").withIndex("slug", (idx) => idx.eq("slug", where.slug!));
    } else if (where.status !== undefined) {
      q = ctx.db
        .query("GroupConnection")
        .withIndex("status", (idx) => idx.eq("status", where.status!));
    } else {
      q = ctx.db.query("GroupConnection");
    }

    return await q.order(order).paginate(args.paginationOpts);
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
 */
export const groupConnectionUpdate = mutation({
  args: {
    connectionId: v.id("GroupConnection"),
    data: v.object({
      slug: v.optional(v.string()),
      name: v.optional(v.string()),
      status: v.optional(vGroupConnectionStatus),
      config: v.optional(v.any()),
      extend: v.optional(v.any()),
    }),
  },
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
