/**
 * `component.maintenance.*` — scheduled cleanup utilities.
 *
 * Wire `pruneExpired` to a daily cron in the consumer app to keep tables
 * with expiring rows (sessions, refresh tokens, verification codes, PKCE
 * verifiers, invites, device codes) bounded.
 *
 * @module
 */

import { v } from "convex/values";

import { mutation } from "./_generated/server";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

/**
 * Delete expired rows across the auth tables (sessions, refresh tokens,
 * verification codes, PKCE verifiers, group invites, device codes) using each
 * table's expiration index, range-scanning up to `batchSize` already-expired
 * rows per table. Rows with no expiry set (never-expire verifiers/invites) are
 * skipped by the index lower bound, so they cannot stall the scan. Returns
 * per-table deletion counts; wire to a daily cron and re-run while counts stay
 * high to clear a backlog.
 */
export const pruneExpired = mutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    sessions: v.number(),
    refreshTokens: v.number(),
    verificationCodes: v.number(),
    authVerifiers: v.number(),
    invites: v.number(),
    deviceCodes: v.number(),
    oauthRefreshTokens: v.number(),
    oauthRefreshGrants: v.number(),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    const now = Date.now();

    let sessions = 0;
    let refreshTokens = 0;
    let verificationCodes = 0;
    let authVerifiers = 0;
    let invites = 0;
    let deviceCodes = 0;
    let oauthRefreshTokens = 0;
    let oauthRefreshGrants = 0;

    const sessionDocs = await ctx.db
      .query("Session")
      .withIndex("expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);
    for (const doc of sessionDocs) {
      await ctx.db.delete("Session", doc._id);
      sessions += 1;
    }

    const refreshDocs = await ctx.db
      .query("RefreshToken")
      .withIndex("expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);
    for (const doc of refreshDocs) {
      await ctx.db.delete("RefreshToken", doc._id);
      refreshTokens += 1;
    }

    const verificationDocs = await ctx.db
      .query("VerificationCode")
      .withIndex("expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);
    for (const doc of verificationDocs) {
      await ctx.db.delete("VerificationCode", doc._id);
      verificationCodes += 1;
    }

    const verifierDocs = await ctx.db
      .query("AuthVerifier")
      .withIndex("expiration_time", (q) => q.gte("expirationTime", 0).lt("expirationTime", now))
      .take(batchSize);
    for (const doc of verifierDocs) {
      await ctx.db.delete("AuthVerifier", doc._id);
      authVerifiers += 1;
    }

    const inviteDocs = await ctx.db
      .query("GroupInvite")
      .withIndex("expires_time", (q) => q.gte("expiresTime", 0).lt("expiresTime", now))
      .take(batchSize);
    for (const doc of inviteDocs) {
      if (doc.status !== "expired" && doc.status !== "revoked") {
        await ctx.db.delete("GroupInvite", doc._id);
        invites += 1;
      }
    }

    const deviceDocs = await ctx.db
      .query("DeviceCode")
      .withIndex("expires_at", (q) => q.lt("expiresAt", now))
      .take(batchSize);
    for (const doc of deviceDocs) {
      await ctx.db.delete("DeviceCode", doc._id);
      deviceCodes += 1;
    }

    const oauthRefreshTokenDocs = await ctx.db
      .query("OAuthRefreshToken")
      .withIndex("expires_at", (q) => q.lt("expiresAt", now))
      .take(batchSize);
    for (const doc of oauthRefreshTokenDocs) {
      await ctx.db.delete("OAuthRefreshToken", doc._id);
      oauthRefreshTokens += 1;
    }

    const oauthRefreshGrantDocs = await ctx.db
      .query("OAuthRefreshGrant")
      .withIndex("expires_at", (q) => q.lt("expiresAt", now))
      .take(batchSize);
    for (const doc of oauthRefreshGrantDocs) {
      await ctx.db.delete("OAuthRefreshGrant", doc._id);
      oauthRefreshGrants += 1;
    }

    return {
      sessions,
      refreshTokens,
      verificationCodes,
      authVerifiers,
      invites,
      deviceCodes,
      oauthRefreshTokens,
      oauthRefreshGrants,
    };
  },
});
