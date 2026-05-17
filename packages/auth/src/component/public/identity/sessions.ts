import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vPaginated, vSessionDoc } from "../../model";

/**
 * List sessions with optional filtering and cursor-based pagination.
 *
 * Supports filtering by `userId` to retrieve only sessions belonging to a
 * specific user. When a `userId` filter is provided, the `user_id` index is
 * used for efficient lookup. Results are returned as a paginated response
 * `{ items, nextCursor }` -- pass `nextCursor` back as `cursor` to fetch the
 * next page, or receive `null` when all results have been exhausted.
 *
 * @param args.where - Optional filter object. Currently supports `userId` to
 *   restrict results to sessions for a specific user.
 * @param args.limit - Maximum number of sessions to return per page (1--100, default 50).
 * @param args.cursor - An opaque cursor string from a previous response's `nextCursor`
 *   to continue pagination, or `null` / omitted to start from the beginning.
 * @param args.order - Sort direction: `"asc"` or `"desc"` (default `"desc"`).
 * @returns An object with `items` (array of session documents) and `nextCursor`
 *   (`string | null`) for fetching subsequent pages.
 *
 */
export const sessionList = query({
  args: {
    where: v.optional(
      v.object({
        userId: v.optional(v.id("User")),
      }),
    ),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    order: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  returns: vPaginated(vSessionDoc),
  handler: async (ctx, args) => {
    const where = args.where ?? {};
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
    const order = args.order ?? "desc";

    let q;
    if (where.userId !== undefined) {
      q = ctx.db.query("Session").withIndex("user_id", (idx) => idx.eq("userId", where.userId!));
    } else {
      q = ctx.db.query("Session");
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
 * Create a new session for a user with a specified expiration time.
 *
 * Inserts a new document into the `Session` table, linking it to the given user.
 * The session represents an active authenticated context and is typically created
 * after a successful sign-in or token refresh.
 *
 * @param args.userId - The document ID of the user this session belongs to.
 * @param args.expirationTime - The Unix timestamp (in milliseconds) at which this session expires.
 * @returns The document ID of the newly created session.
 *
 */
export const sessionCreate = mutation({
  args: { userId: v.id("User"), expirationTime: v.number() },
  returns: v.id("Session"),
  handler: async (ctx, { userId, expirationTime }) => {
    return await ctx.db.insert("Session", {
      userId: userId as any,
      expirationTime,
    });
  },
});

export const sessionIssue = mutation({
  args: {
    userId: v.id("User"),
    sessionId: v.optional(v.id("Session")),
    replaceSessionId: v.optional(v.id("Session")),
    sessionExpirationTime: v.number(),
    refreshTokenExpirationTime: v.optional(v.number()),
  },
  returns: v.object({
    userId: v.id("User"),
    sessionId: v.id("Session"),
    refreshTokenId: v.optional(v.id("RefreshToken")),
  }),
  handler: async (ctx, args) => {
    let sessionId = args.sessionId;

    if (sessionId === undefined) {
      if (args.replaceSessionId !== undefined) {
        const existingSession = await ctx.db.get("Session", args.replaceSessionId);
        if (existingSession !== null) {
          await ctx.db.delete("Session", args.replaceSessionId);
        }

        const existingTokens = await ctx.db
          .query("RefreshToken")
          .withIndex("session_id", (q) => q.eq("sessionId", args.replaceSessionId!))
          .collect();
        await Promise.all(existingTokens.map((token) => ctx.db.delete("RefreshToken", token._id)));
      }

      sessionId = await ctx.db.insert("Session", {
        userId: args.userId as any,
        expirationTime: args.sessionExpirationTime,
      });
    }

    const refreshTokenId =
      args.refreshTokenExpirationTime === undefined
        ? undefined
        : await ctx.db.insert("RefreshToken", {
            sessionId: sessionId as any,
            expirationTime: args.refreshTokenExpirationTime,
          });

    return {
      userId: args.userId,
      sessionId,
      ...(refreshTokenId === undefined ? {} : { refreshTokenId }),
    };
  },
});

/**
 * Retrieve a single session by its Convex document ID.
 *
 * Performs a direct point lookup on the `Session` table. Returns `null` if the
 * session has been deleted or never existed. This does not check whether the
 * session has expired -- callers should compare `expirationTime` to the current
 * time if needed.
 *
 * @param args.sessionId - The Convex document ID (`Id<"Session">`) of the session to retrieve.
 * @returns The session document if it exists, or `null` otherwise.
 *
 */
export const sessionGetById = query({
  args: { sessionId: v.id("Session") },
  returns: v.union(vSessionDoc, v.null()),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db.get("Session", sessionId);
  },
});

/**
 * Delete a session document.
 *
 * Removes the session from the `Session` table. This is a no-op if the session
 * does not exist (i.e. was already deleted). Callers should also clean up
 * related refresh tokens via `refreshTokenDeleteAll` to fully invalidate the
 * session.
 *
 * @param args.sessionId - The document ID of the session to delete.
 * @returns `null` on success (including when the session was already absent).
 *
 */
export const sessionDelete = mutation({
  args: { sessionId: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    if ((await ctx.db.get("Session", sessionId)) !== null) {
      await ctx.db.delete("Session", sessionId);
    }
    return null;
  },
});

/**
 * List all sessions belonging to a specific user.
 *
 * Queries the `Session` table using the `user_id` index to efficiently retrieve
 * every session document for the given user. Unlike `sessionList`, this returns
 * all matching sessions without pagination.
 *
 * @param args.userId - The document ID of the user whose sessions should be retrieved.
 * @returns An array of session documents for the specified user.
 *
 */
export const sessionListByUser = query({
  args: { userId: v.id("User") },
  returns: v.array(vSessionDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Session")
      .withIndex("user_id", (q) => q.eq("userId", userId as any))
      .collect();
  },
});

// ============================================================================
// Verifiers
// ============================================================================
