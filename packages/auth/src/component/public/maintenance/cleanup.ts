import { v } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import { mutation } from "../../_generated/server";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

/**
 * Sweep expired rows from auth tables that carry an expiration timestamp.
 *
 * Designed to be called from a daily (or hourly) cron in the consumer app:
 *
 * ```ts
 * // convex/crons.ts
 * import { cronJobs } from "convex/server";
 * import { components } from "./_generated/api";
 *
 * const crons = cronJobs();
 * crons.daily(
 *   "auth-prune-expired",
 *   { hourUTC: 3, minuteUTC: 0 },
 *   components.auth.maintenance.pruneExpired,
 *   {},
 * );
 * export default crons;
 * ```
 *
 * Each table is pruned with `.withIndex("by_creation_time")` taking the
 * oldest `batchSize` rows and filtering those whose expiration is in the
 * past, so a single run stays well under Convex's per-transaction limits.
 * Re-run the cron tomorrow to drain any backlog.
 *
 * Returns a per-table count of deleted documents.
 */
export const pruneExpired = mutation({
  args: {
    /** Max docs to scan per table per run. Defaults to 200, capped at 1000. */
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    sessions: v.number(),
    refreshTokens: v.number(),
    verificationCodes: v.number(),
    authVerifiers: v.number(),
    invites: v.number(),
    deviceCodes: v.number(),
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

    const sessionDocs = await ctx.db.query("Session").order("asc").take(batchSize);
    for (const doc of sessionDocs) {
      if (doc.expirationTime < now) {
        await ctx.db.delete("Session", doc._id as Id<"Session">);
        sessions += 1;
      }
    }

    const refreshDocs = await ctx.db.query("RefreshToken").order("asc").take(batchSize);
    for (const doc of refreshDocs) {
      if (doc.expirationTime < now) {
        await ctx.db.delete("RefreshToken", doc._id as Id<"RefreshToken">);
        refreshTokens += 1;
      }
    }

    const verificationDocs = await ctx.db.query("VerificationCode").order("asc").take(batchSize);
    for (const doc of verificationDocs) {
      if (doc.expirationTime < now) {
        await ctx.db.delete("VerificationCode", doc._id as Id<"VerificationCode">);
        verificationCodes += 1;
      }
    }

    const verifierDocs = await ctx.db.query("AuthVerifier").order("asc").take(batchSize);
    for (const doc of verifierDocs) {
      if (typeof doc.expirationTime === "number" && doc.expirationTime < now) {
        await ctx.db.delete("AuthVerifier", doc._id as Id<"AuthVerifier">);
        authVerifiers += 1;
      }
    }

    const inviteDocs = await ctx.db.query("GroupInvite").order("asc").take(batchSize);
    for (const doc of inviteDocs) {
      if (
        typeof doc.expiresTime === "number" &&
        doc.expiresTime < now &&
        doc.status !== "expired" &&
        doc.status !== "revoked"
      ) {
        await ctx.db.delete("GroupInvite", doc._id as Id<"GroupInvite">);
        invites += 1;
      }
    }

    const deviceDocs = await ctx.db.query("DeviceCode").order("asc").take(batchSize);
    for (const doc of deviceDocs) {
      if (doc.expiresAt < now) {
        await ctx.db.delete("DeviceCode", doc._id as Id<"DeviceCode">);
        deviceCodes += 1;
      }
    }

    return {
      sessions,
      refreshTokens,
      verificationCodes,
      authVerifiers,
      invites,
      deviceCodes,
    };
  },
});
