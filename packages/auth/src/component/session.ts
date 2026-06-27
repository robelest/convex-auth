/**
 * `component.session.*` — auth sessions.
 *
 * `issue` is a kept domain verb (token issuance).
 *
 * @module
 */

import { getManyFrom } from "convex-helpers/server/relationships";
import { v } from "convex/values";

import { mutation, query } from "./functions";
import { vSessionDoc } from "./model";

/** Read a session by id. */
export const get = query({
  args: { id: v.id("Session") },
  returns: v.union(vSessionDoc, v.null()),
  handler: async (ctx, { id: sessionId }) => {
    return await ctx.db.get("Session", sessionId);
  },
});

/** List the sessions owned by a user. */
export const list = query({
  args: { userId: v.id("User") },
  returns: v.array(vSessionDoc),
  handler: async (ctx, { userId }) => {
    return await getManyFrom(ctx.db, "Session", "user_id", userId, "userId");
  },
});

/**
 * Create (or rotate) a session together with its first refresh token.
 * Returns the resolved `{ userId, sessionId, refreshTokenId }` — a command
 * summary rather than `v.null()` — because callers need the freshly minted
 * ids to mint tokens and set cookies.
 */
export const create = mutation({
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

        const existingTokens = await getManyFrom(
          ctx.db,
          "RefreshToken",
          "session_id",
          args.replaceSessionId!,
          "sessionId",
        );
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

/** Delete a session (no-op if it no longer exists). */
const remove = mutation({
  args: { id: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { id: sessionId }) => {
    if ((await ctx.db.get("Session", sessionId)) !== null) {
      await ctx.db.delete("Session", sessionId);
    }
    return null;
  },
});

export { remove };
