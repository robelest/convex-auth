import { v } from "convex/values";

import { internalMutation, internalQuery } from "../../functions";
import { vRefreshTokenDoc } from "../../model";

/**
 * Create a new refresh token for a session.
 *
 * Inserts a document into the `RefreshToken` table. Refresh tokens are used to
 * obtain new access tokens without requiring the user to re-authenticate. When
 * a refresh token is rotated, the new token references the old one via
 * `parentRefreshTokenId` to form a token chain for replay detection.
 *
 * @param args.sessionId - The document ID of the session this refresh token belongs to.
 * @param args.expirationTime - The Unix timestamp (in milliseconds) at which this refresh token expires.
 * @param args.parentRefreshTokenId - The document ID of the parent refresh token that was
 *   exchanged to create this one. Omitted for the initial token in a session.
 * @returns The document ID of the newly created refresh token.
 *
 */
export const refreshTokenCreate = internalMutation({
  args: {
    sessionId: v.id("Session"),
    expirationTime: v.number(),
    parentRefreshTokenId: v.optional(v.id("RefreshToken")),
  },
  returns: v.id("RefreshToken"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("RefreshToken", args);
  },
});

/**
 * Read a refresh token by identity — one function, all-optional args,
 * unioned return: `{ id }` (point lookup) or `{ activeForSession }`
 * (newest unused token for a session).
 */
export const refreshTokenGet = internalQuery({
  args: {
    id: v.optional(v.id("RefreshToken")),
    activeForSession: v.optional(v.id("Session")),
  },
  returns: v.union(vRefreshTokenDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.activeForSession !== undefined) {
      return await ctx.db
        .query("RefreshToken")
        .withIndex("session_id_first_used", (q) =>
          q.eq("sessionId", args.activeForSession!).eq("firstUsedTime", undefined),
        )
        .order("desc")
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("RefreshToken", args.id);
  },
});

/**
 * Patch a refresh token document with partial data.
 *
 * Merges the provided fields into the existing refresh token document. This is
 * primarily used to record `firstUsedTime` when a refresh token is first
 * exchanged, marking it as consumed for replay detection.
 *
 * @param args.refreshTokenId - The document ID of the refresh token to update.
 * @param args.data - A partial object containing the fields to merge (e.g. `{ firstUsedTime: number }`).
 * @returns `null` on success.
 *
 */
export const refreshTokenPatch = internalMutation({
  args: {
    refreshTokenId: v.id("RefreshToken"),
    data: v.object({
      sessionId: v.optional(v.id("Session")),
      expirationTime: v.optional(v.number()),
      firstUsedTime: v.optional(v.number()),
      parentRefreshTokenId: v.optional(v.id("RefreshToken")),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { refreshTokenId, data }) => {
    await ctx.db.patch("RefreshToken", refreshTokenId, data);
    return null;
  },
});

/**
 * Get child tokens that were created by exchanging a specific parent token.
 *
 * Queries the `RefreshToken` table using the `session_id_parent_refresh_token_id`
 * index to find all tokens whose `parentRefreshTokenId` matches the provided
 * parent. This is used for replay detection: if a parent token has more than
 * one child, it indicates a potential token reuse attack.
 *
 * @param args.sessionId - The document ID of the session the tokens belong to.
 * @param args.parentRefreshTokenId - The document ID of the parent refresh token whose children to retrieve.
 * @returns An array of refresh token documents that were derived from the specified parent token.
 *
 */
export const refreshTokenGetChildren = internalQuery({
  args: {
    sessionId: v.id("Session"),
    parentRefreshTokenId: v.id("RefreshToken"),
  },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId, parentRefreshTokenId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q.eq("sessionId", sessionId).eq("parentRefreshTokenId", parentRefreshTokenId),
      )
      .collect();
  },
});

/**
 * List all refresh tokens belonging to a specific session.
 *
 * Queries the `RefreshToken` table using the `session_id_parent_refresh_token_id`
 * index to efficiently retrieve every refresh token associated with the given
 * session, including both active and consumed tokens.
 *
 * @param args.sessionId - The document ID of the session whose refresh tokens should be retrieved.
 * @returns An array of all refresh token documents for the specified session.
 *
 */
export const refreshTokenListBySession = internalQuery({
  args: { sessionId: v.id("Session") },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id", (q) => q.eq("sessionId", sessionId))
      .collect();
  },
});

/**
 * Delete all refresh tokens for a session.
 *
 * Queries the `RefreshToken` table for all tokens belonging to the given session
 * and deletes them in parallel. This is typically called when a session is
 * revoked or when token reuse is detected, effectively invalidating the entire
 * token chain for that session.
 *
 * @param args.sessionId - The document ID of the session whose refresh tokens should be deleted.
 * @returns `null` on success.
 *
 */
export const refreshTokenDeleteAll = internalMutation({
  args: { sessionId: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const tokens = await ctx.db
      .query("RefreshToken")
      .withIndex("session_id", (q) => q.eq("sessionId", sessionId))
      .collect();
    await Promise.all(tokens.map((token) => ctx.db.delete("RefreshToken", token._id)));
    return null;
  },
});

const refreshSessionExchangeResult = v.union(
  v.object({
    userId: v.id("User"),
    sessionId: v.id("Session"),
    refreshTokenId: v.id("RefreshToken"),
  }),
  v.null(),
);

export const refreshTokenExchange = internalMutation({
  args: {
    refreshTokenId: v.id("RefreshToken"),
    sessionId: v.id("Session"),
    now: v.number(),
    refreshTokenExpirationTime: v.number(),
    reuseWindowMs: v.number(),
  },
  returns: refreshSessionExchangeResult,
  handler: async (ctx, args) => {
    const cleanupSessionArtifacts = async () => {
      const session = await ctx.db.get("Session", args.sessionId);
      if (session !== null) {
        await ctx.db.delete("Session", args.sessionId);
      }
      const tokens = await ctx.db
        .query("RefreshToken")
        .withIndex("session_id", (q) => q.eq("sessionId", args.sessionId))
        .collect();
      await Promise.all(tokens.map((token) => ctx.db.delete("RefreshToken", token._id)));
    };

    const refreshTokenDoc = await ctx.db.get("RefreshToken", args.refreshTokenId);
    if (refreshTokenDoc === null || refreshTokenDoc.sessionId !== args.sessionId) {
      return null;
    }

    if (refreshTokenDoc.expirationTime < args.now) {
      await cleanupSessionArtifacts();
      return null;
    }

    const session = await ctx.db.get("Session", args.sessionId);
    if (session === null || session.expirationTime < args.now) {
      await cleanupSessionArtifacts();
      return null;
    }

    const issueRefreshToken = () =>
      ctx.db.insert("RefreshToken", {
        sessionId: args.sessionId,
        expirationTime: args.refreshTokenExpirationTime,
        parentRefreshTokenId: args.refreshTokenId,
      });

    if (refreshTokenDoc.firstUsedTime === undefined) {
      await ctx.db.patch("RefreshToken", args.refreshTokenId, {
        firstUsedTime: args.now,
      });
      const refreshTokenId = await issueRefreshToken();
      return {
        userId: session.userId,
        sessionId: args.sessionId,
        refreshTokenId,
      };
    }

    const activeRefreshToken = await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_first_used", (q) =>
        q.eq("sessionId", args.sessionId).eq("firstUsedTime", undefined),
      )
      .order("desc")
      .first();

    if (
      activeRefreshToken !== null &&
      activeRefreshToken.parentRefreshTokenId === args.refreshTokenId
    ) {
      return {
        userId: session.userId,
        sessionId: args.sessionId,
        refreshTokenId: activeRefreshToken._id,
      };
    }

    if (refreshTokenDoc.firstUsedTime + args.reuseWindowMs > args.now) {
      const refreshTokenId = await issueRefreshToken();
      return {
        userId: session.userId,
        sessionId: args.sessionId,
        refreshTokenId,
      };
    }

    const tokensToInvalidate = [refreshTokenDoc];
    const visited = new Set([refreshTokenDoc._id]);
    let frontier = [refreshTokenDoc._id];

    while (frontier.length > 0) {
      const nextFrontier = [] as Array<typeof refreshTokenDoc._id>;
      for (const parentRefreshTokenId of frontier) {
        const children = await ctx.db
          .query("RefreshToken")
          .withIndex("session_id_parent_refresh_token_id", (q) =>
            q.eq("sessionId", args.sessionId).eq("parentRefreshTokenId", parentRefreshTokenId),
          )
          .collect();
        for (const child of children) {
          if (visited.has(child._id)) {
            continue;
          }
          visited.add(child._id);
          tokensToInvalidate.push(child);
          nextFrontier.push(child._id);
        }
      }
      frontier = nextFrontier;
    }

    await Promise.all(
      tokensToInvalidate
        .filter(
          (token) =>
            token.firstUsedTime === undefined ||
            token.firstUsedTime > args.now - args.reuseWindowMs,
        )
        .map((token) =>
          ctx.db.patch("RefreshToken", token._id, {
            firstUsedTime: args.now - args.reuseWindowMs,
          }),
        ),
    );

    return null;
  },
});

