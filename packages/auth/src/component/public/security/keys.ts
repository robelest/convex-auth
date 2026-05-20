import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import {
  vApiKeyDoc,
  vApiKeyRateLimit,
  vApiKeyRateLimitState,
  vApiKeyScope,
  vPaginated,
} from "../../model";

// ============================================================================
// API Keys
// ============================================================================

/**
 * Insert a new API key record into the `ApiKey` table.
 *
 * Creates an API key entry with the given metadata and scopes. The caller
 * is responsible for generating and hashing the raw key before passing it
 * here -- this function only stores the hash, never the plaintext key.
 * The `createdAt` timestamp and `revoked: false` flag are set automatically.
 *
 * @param userId - The `_id` of the `User` who owns this API key.
 * @param prefix - A short, visible prefix for the key (e.g. `"sk_live_"`)
 *   that helps users identify which key was used without exposing the secret.
 * @param hashedKey - SHA-256 hash of the full API key string. Used for
 *   constant-time lookup during Bearer token verification.
 * @param name - Human-readable name for the key (e.g. `"Production Backend"`).
 * @param scopes - Array of permission scopes, each containing a `resource`
 *   name and an array of allowed `actions` (e.g.
 *   `[{ resource: "messages", actions: ["read", "write"] }]`).
 * @param rateLimit - Optional rate limit configuration to apply per-key
 *   (e.g. max requests per window).
 * @param expiresAt - Optional Unix timestamp (in milliseconds) after which
 *   the key is no longer valid. Omit for non-expiring keys.
 * @param metadata - Optional arbitrary metadata to attach to the key record.
 * @returns The `_id` of the newly created `ApiKey` document.
 *
 */
export const keyInsert = mutation({
  args: {
    userId: v.id("User"),
    prefix: v.string(),
    hashedKey: v.string(),
    name: v.string(),
    scopes: v.array(
      v.object({
        resource: v.string(),
        actions: v.array(v.string()),
      }),
    ),
    rateLimit: v.optional(vApiKeyRateLimit),
    expiresAt: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  returns: v.id("ApiKey"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("ApiKey", {
      ...args,
      createdAt: Date.now(),
      revoked: false,
    });
  },
});

/**
 * Read an API key by identity — one function, all-optional args, unioned
 * return: `{ id }` (point lookup) or `{ hashedKey }` (Bearer-verify
 * index).
 */
export const keyGet = query({
  args: {
    id: v.optional(v.id("ApiKey")),
    hashedKey: v.optional(v.string()),
  },
  returns: v.union(vApiKeyDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.hashedKey !== undefined) {
      return await ctx.db
        .query("ApiKey")
        .withIndex("hashed_key", (q) => q.eq("hashedKey", args.hashedKey!))
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("ApiKey", args.id);
  },
});

/**
 * List API keys with optional filtering, sorting, and cursor-based pagination.
 *
 * Returns a paginated result `{ items, nextCursor }` from the `ApiKey`
 * table. Supports filtering by `userId`, `revoked` status, `name`, and
 * `prefix`. The page size is clamped between 1 and 100 (default 50).
 * Pass the returned `nextCursor` as `cursor` in a subsequent call to
 * fetch the next page.
 *
 * @param where - Optional filter object. All specified fields are
 *   combined with AND logic:
 *   - `userId` -- restrict to keys owned by this user.
 *   - `revoked` -- `true` for revoked keys, `false` for active keys.
 *   - `name` -- exact match on the key's human-readable name.
 *   - `prefix` -- exact match on the key prefix string.
 * @param limit - Maximum number of items to return per page (1--100,
 *   default `50`).
 * @param cursor - Opaque cursor string (an `ApiKey` document `_id`)
 *   returned from a previous call. Pass `null` or omit for the first page.
 * @param orderBy - Field to sort by. One of `"_creationTime"`, `"name"`,
 *   `"lastUsedAt"`, `"expiresAt"`, or `"revoked"`. Defaults to
 *   `"_creationTime"`.
 * @param order - Sort direction, `"asc"` or `"desc"` (default `"desc"`).
 * @returns An object with `items` (array of `ApiKey` documents) and
 *   `nextCursor` (string ID of the last item, or `null` if no more pages).
 *
 */
export const keyList = query({
  args: {
    where: v.optional(
      v.object({
        userId: v.optional(v.id("User")),
        revoked: v.optional(v.boolean()),
        name: v.optional(v.string()),
        prefix: v.optional(v.string()),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    orderBy: v.optional(
      v.union(
        v.literal("_creationTime"),
        v.literal("name"),
        v.literal("lastUsedAt"),
        v.literal("expiresAt"),
        v.literal("revoked"),
      ),
    ),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vApiKeyDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.userId !== undefined) {
      q = ctx.db.query("ApiKey").withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("ApiKey");
    }

    if (where.revoked !== undefined) {
      q = q.filter((f) => f.eq(f.field("revoked"), where.revoked!));
    }
    if (where.name !== undefined) {
      q = q.filter((f) => f.eq(f.field("name"), where.name!));
    }
    if (where.prefix !== undefined) {
      q = q.filter((f) => f.eq(f.field("prefix"), where.prefix!));
    }

    q = q.order(order);

    const result = await q.paginate({ numItems: limit, cursor: args.cursor ?? null });
    return {
      items: result.page,
      nextCursor: result.isDone ? null : result.continueCursor,
    };
  },
});


/**
 * Patch an API key record with partial updates.
 *
 * Performs a partial update on the `ApiKey` document. Supports modifying
 * the key's name, scopes, rate limit configuration, rate limit state,
 * revocation flag, and last-used timestamp. Throws a `ConvexError` with
 * code `"KEY_NOT_FOUND"` if the key does not exist.
 *
 * @param keyId - The `_id` of the `ApiKey` document to update.
 * @param data - An object containing the fields to patch. All fields are
 *   optional:
 *   - `name` -- Updated human-readable name.
 *   - `scopes` -- Replacement array of permission scopes.
 *   - `rateLimit` -- Updated rate limit configuration.
 *   - `rateLimitState` -- Updated rate limit tracking state (token
 *     count, last refill time).
 *   - `revoked` -- Set to `true` to revoke the key, `false` to
 *     reinstate it.
 *   - `lastUsedAt` -- Unix timestamp (in milliseconds) of the most
 *     recent API call using this key.
 * @returns `null` on success.
 *
 */
export const keyPatch = mutation({
  args: {
    keyId: v.id("ApiKey"),
    data: v.object({
      name: v.optional(v.string()),
      scopes: v.optional(v.array(vApiKeyScope)),
      rateLimit: v.optional(vApiKeyRateLimit),
      rateLimitState: v.optional(vApiKeyRateLimitState),
      revoked: v.optional(v.boolean()),
      lastUsedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { keyId, data }) => {
    const key = await ctx.db.get("ApiKey", keyId);
    if (key === null) {
      throw new ConvexError({
        code: "KEY_NOT_FOUND",
        message: "API key not found",
        keyId,
      });
    }
    await ctx.db.patch("ApiKey", keyId, data);
    return null;
  },
});

/**
 * Hard-delete an API key record from the `ApiKey` table.
 *
 * Permanently removes the API key document. Unlike revocation (which
 * keeps the record for audit purposes), this is an irreversible
 * deletion. Throws a `ConvexError` with code `"KEY_NOT_FOUND"` if the
 * key does not exist.
 *
 * @param keyId - The `_id` of the `ApiKey` document to delete.
 * @returns `null` on success.
 *
 */
export const keyDelete = mutation({
  args: { keyId: v.id("ApiKey") },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    const key = await ctx.db.get("ApiKey", keyId);
    if (key === null) {
      throw new ConvexError({
        code: "KEY_NOT_FOUND",
        message: "API key not found",
        keyId,
      });
    }
    await ctx.db.delete("ApiKey", keyId);
    return null;
  },
});
