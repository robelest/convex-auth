/**
 * `component.oauth.client.*` — OAuth 2.1 client registration.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";
import { ErrorCode } from "../../shared/codes";

import { mutation, query } from "../functions";
import { vOAuthClientDoc, vPaginated, vTokenEndpointAuthMethod } from "../model";
import schema from "../schema";

/**
 * Read a client by identity. Accepts exactly one selector:
 * - `{ id }`       → `Doc<"OAuthClient"> | null`
 * - `{ clientId }` → `Doc<"OAuthClient"> | null`
 */
export const get = query({
  args: {
    id: v.optional(v.id("OAuthClient")),
    clientId: v.optional(v.string()),
  },
  returns: v.union(vOAuthClientDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.clientId !== undefined) {
      return await ctx.db
        .query("OAuthClient")
        .withIndex("client_id", (q) => q.eq("clientId", args.clientId!))
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("OAuthClient", args.id);
  },
});

/** Register a new OAuth client (created un-revoked). Returns the new id. */
export const create = mutation({
  args: {
    clientId: v.string(),
    clientSecretHash: v.optional(v.string()),
    name: v.string(),
    redirectUris: v.array(v.string()),
    scopes: v.array(v.string()),
    grantTypes: v.array(v.string()),
    tokenEndpointAuthMethod: v.optional(vTokenEndpointAuthMethod),
    registrationAccessTokenHash: v.optional(v.string()),
    createdBy: v.optional(v.id("User")),
    extend: v.optional(v.any()),
  },
  returns: v.id("OAuthClient"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("OAuthClient", { ...args, revoked: false });
  },
});

/**
 * Replace an OAuth client's mutable registration metadata (RFC 7592 `PUT`).
 * Looks the client up by `clientId`; throws if absent. Setting the method to
 * `none` also clears any stored `clientSecretHash` so a downgraded client can
 * never be authenticated by a stale secret.
 */
export const update = mutation({
  args: {
    clientId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      redirectUris: v.optional(v.array(v.string())),
      scopes: v.optional(v.array(v.string())),
      grantTypes: v.optional(v.array(v.string())),
      tokenEndpointAuthMethod: v.optional(vTokenEndpointAuthMethod),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { clientId, patch }) => {
    const doc = await ctx.db
      .query("OAuthClient")
      .withIndex("client_id", (q) => q.eq("clientId", clientId))
      .first();
    if (doc === null) {
      throw new ConvexError({ code: ErrorCode.OAUTH_CLIENT_NOT_FOUND, clientId });
    }
    const next: Record<string, unknown> = { ...patch };
    if (patch.tokenEndpointAuthMethod === "none") next.clientSecretHash = undefined;
    await ctx.db.patch("OAuthClient", doc._id, next);
    return null;
  },
});

/**
 * Page over OAuth clients, optionally scoped by `createdBy`. Archived clients
 * are excluded unless `where.includeRevoked` is set.
 */
export const list = query({
  args: {
    where: v.optional(
      v.object({
        createdBy: v.optional(v.id("User")),
        includeRevoked: v.optional(v.boolean()),
      }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPaginated(vOAuthClientDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const includeRevoked = where.includeRevoked === true;
    const base = paginator(ctx.db, schema).query("OAuthClient");
    const q =
      where.createdBy !== undefined && !includeRevoked
        ? base.withIndex("created_by_revoked", (idx) =>
            idx.eq("createdBy", where.createdBy!).eq("revoked", false),
          )
        : where.createdBy !== undefined
          ? base.withIndex("created_by", (idx) => idx.eq("createdBy", where.createdBy!))
          : !includeRevoked
            ? base.withIndex("revoked", (idx) => idx.eq("revoked", false))
            : base;
    return await q.paginate(args.paginationOpts);
  },
});

/** Soft-delete a client by `clientId` (sets `revoked`); throws if not found. */
export const revoke = mutation({
  args: { clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientId }) => {
    const doc = await ctx.db
      .query("OAuthClient")
      .withIndex("client_id", (q) => q.eq("clientId", clientId))
      .first();
    if (doc === null) {
      throw new ConvexError({ code: ErrorCode.OAUTH_CLIENT_NOT_FOUND, clientId });
    }
    await ctx.db.patch("OAuthClient", doc._id, { revoked: true });
    return null;
  },
});
