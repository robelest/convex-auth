import {
  ConvexError,
  mutation,
  query,
  v,
  vApiKeyDoc,
  vApiKeyRateLimit,
  vApiKeyRateLimitState,
  vApiKeyScope,
  vPaginated,
} from "./shared";

// ============================================================================
// API Keys
// ============================================================================

/**
 * Insert a new API key record.
 *
 * The caller is responsible for hashing the raw key before passing it here —
 * this function only stores the hash and metadata.
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
 * Look up an API key by its SHA-256 hash.
 *
 * Used during Bearer token verification. Returns the full key record
 * (including rate limit state) or `null` if not found.
 */
export const keyGetByHashedKey = query({
  args: { hashedKey: v.string() },
  returns: v.union(vApiKeyDoc, v.null()),
  handler: async (ctx, { hashedKey }) => {
    return await ctx.db
      .query("ApiKey")
      .withIndex("hashed_key", (q) => q.eq("hashedKey", hashedKey))
      .first();
  },
});

/**
 * @deprecated Use `keyList` with `where: { userId }` instead.
 * Kept for backward compatibility with generated component types.
 */
export const keyListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vApiKeyDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("ApiKey")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * List API keys with optional filtering, sorting, and pagination.
 *
 * Returns `{ items, nextCursor }`. Supports filtering by `userId`,
 * `revoked`, `name`, and `prefix`.
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
      q = ctx.db
        .query("ApiKey")
        .withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
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

/** Get a single API key by document ID. */
export const keyGetById = query({
  args: { keyId: v.id("ApiKey") },
  returns: v.union(vApiKeyDoc, v.null()),
  handler: async (ctx, { keyId }) => {
    return await ctx.db.get("ApiKey", keyId);
  },
});

/**
 * Patch an API key record. Used for updating name, scopes, rate limit config,
 * revocation, and lastUsedAt / rate limit state tracking.
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

/** Hard delete an API key record. */
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
