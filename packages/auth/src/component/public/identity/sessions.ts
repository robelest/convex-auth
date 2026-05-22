import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vSessionDoc } from "../../model";

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
      userId: userId,
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
        userId: args.userId,
        expirationTime: args.sessionExpirationTime,
      });
    }

    const refreshTokenId =
      args.refreshTokenExpirationTime === undefined
        ? undefined
        : await ctx.db.insert("RefreshToken", {
            sessionId: sessionId,
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
 * Queries the `Session` table using the `user_id` index to retrieve
 * every session document for the given user, as a flat array.
 *
 * @param args.userId - The document ID of the user whose sessions should be retrieved.
 * @returns An array of session documents for the specified user.
 *
 */
export const sessionList = query({
  args: { userId: v.id("User") },
  returns: v.array(vSessionDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Session")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

// ============================================================================
// Verifiers
// ============================================================================
