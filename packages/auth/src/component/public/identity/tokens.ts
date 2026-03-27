import { v } from "convex/values";

import { mutation, query } from "../../functions";
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
 * @example
 * ```ts
 * const tokenId = await ctx.runMutation(
 *   component.identity.tokens.refreshTokenCreate,
 *   {
 *     sessionId: session._id,
 *     expirationTime: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
 *   },
 * );
 * ```
 */
export const refreshTokenCreate = mutation({
  args: {
    sessionId: v.id("Session"),
    expirationTime: v.number(),
    parentRefreshTokenId: v.optional(v.id("RefreshToken")),
  },
  returns: v.id("RefreshToken"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("RefreshToken", args as any);
  },
});

/**
 * Retrieve a single refresh token by its Convex document ID.
 *
 * Performs a direct point lookup on the `RefreshToken` table. Returns `null` if
 * the token has been deleted or never existed.
 *
 * @param args.refreshTokenId - The Convex document ID (`Id<"RefreshToken">`) of the token to retrieve.
 * @returns The refresh token document if it exists, or `null` otherwise.
 *
 * @example
 * ```ts
 * const token = await ctx.runQuery(
 *   component.identity.tokens.refreshTokenGetById,
 *   { refreshTokenId: storedTokenId },
 * );
 * if (token !== null && token.expirationTime > Date.now()) {
 *   console.log("Refresh token is still valid");
 * }
 * ```
 */
export const refreshTokenGetById = query({
  args: { refreshTokenId: v.id("RefreshToken") },
  returns: v.union(vRefreshTokenDoc, v.null()),
  handler: async (ctx, { refreshTokenId }) => {
    return await ctx.db.get("RefreshToken", refreshTokenId);
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
 * @example
 * ```ts
 * // Mark the refresh token as used
 * await ctx.runMutation(
 *   component.identity.tokens.refreshTokenPatch,
 *   {
 *     refreshTokenId: token._id,
 *     data: { firstUsedTime: Date.now() },
 *   },
 * );
 * ```
 */
export const refreshTokenPatch = mutation({
  args: { refreshTokenId: v.id("RefreshToken"), data: v.any() },
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
 * @example
 * ```ts
 * const children = await ctx.runQuery(
 *   component.identity.tokens.refreshTokenGetChildren,
 *   {
 *     sessionId: session._id,
 *     parentRefreshTokenId: parentToken._id,
 *   },
 * );
 * if (children.length > 1) {
 *   console.warn("Possible token reuse detected!");
 * }
 * ```
 */
export const refreshTokenGetChildren = query({
  args: {
    sessionId: v.id("Session"),
    parentRefreshTokenId: v.id("RefreshToken"),
  },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId, parentRefreshTokenId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q
          .eq("sessionId", sessionId as any)
          .eq("parentRefreshTokenId", parentRefreshTokenId as any),
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
 * @example
 * ```ts
 * const tokens = await ctx.runQuery(
 *   component.identity.tokens.refreshTokenListBySession,
 *   { sessionId: session._id },
 * );
 * console.log(`Session has ${tokens.length} refresh token(s)`);
 * ```
 */
export const refreshTokenListBySession = query({
  args: { sessionId: v.id("Session") },
  returns: v.array(vRefreshTokenDoc),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q.eq("sessionId", sessionId as any),
      )
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
 * @example
 * ```ts
 * // Invalidate all tokens for a compromised session
 * await ctx.runMutation(
 *   component.identity.tokens.refreshTokenDeleteAll,
 *   { sessionId: session._id },
 * );
 * ```
 */
export const refreshTokenDeleteAll = mutation({
  args: { sessionId: v.id("Session") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const tokens = await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_parent_refresh_token_id", (q) =>
        q.eq("sessionId", sessionId as any),
      )
      .collect();
    await Promise.all(
      tokens.map((token) => ctx.db.delete("RefreshToken", token._id)),
    );
    return null;
  },
});

/**
 * Get the active (unused) refresh token for a session.
 *
 * Queries the `RefreshToken` table using the `session_id_first_used` index to
 * find the most recently created token for the session that has not yet been
 * exchanged (i.e. `firstUsedTime` is `undefined`). This represents the current
 * valid refresh token the client should be holding.
 *
 * @param args.sessionId - The document ID of the session whose active refresh token should be retrieved.
 * @returns The most recent unused refresh token document, or `null` if no active token exists
 *   (e.g. all tokens have been consumed or the session has no tokens).
 *
 * @example
 * ```ts
 * const activeToken = await ctx.runQuery(
 *   component.identity.tokens.refreshTokenGetActive,
 *   { sessionId: session._id },
 * );
 * if (activeToken !== null) {
 *   console.log(`Active token expires at: ${activeToken.expirationTime}`);
 * }
 * ```
 */
export const refreshTokenGetActive = query({
  args: { sessionId: v.id("Session") },
  returns: v.union(vRefreshTokenDoc, v.null()),
  handler: async (ctx, { sessionId }) => {
    return await ctx.db
      .query("RefreshToken")
      .withIndex("session_id_first_used", (q) =>
        q.eq("sessionId", sessionId as any).eq("firstUsedTime", undefined),
      )
      .order("desc")
      .first();
  },
});
