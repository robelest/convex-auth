import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vTotpFactorDoc } from "../../model";

/**
 * Store a new TOTP (Time-based One-Time Password) enrollment for a user.
 *
 * Creates a `TotpFactor` record containing the shared secret and OTP
 * parameters. The enrollment starts in an unverified state until the
 * user confirms it by submitting a valid code generated from the secret.
 *
 * @param userId - The `_id` of the `User` enrolling in TOTP-based 2FA.
 * @param secret - The shared secret key as raw bytes, typically 20 bytes
 *   of cryptographically random data.
 * @param digits - Number of digits in the generated OTP code (usually `6`).
 * @param period - Time step in seconds for code generation (usually `30`).
 * @param verified - Whether the enrollment has been verified. Set to
 *   `false` during initial setup; set to `true` after the user submits
 *   a valid code.
 * @param name - Optional human-readable label for the TOTP factor
 *   (e.g. `"Google Authenticator"`).
 * @param createdAt - Unix timestamp (in milliseconds) when the enrollment
 *   was created.
 * @returns The `_id` of the newly created `TotpFactor` document.
 *
 * @example
 * ```ts
 * const totpId = await ctx.runMutation(
 *   components.auth.factors.totp.totpInsert,
 *   {
 *     userId: user._id,
 *     secret: crypto.getRandomValues(new Uint8Array(20)),
 *     digits: 6,
 *     period: 30,
 *     verified: false,
 *     name: "Authenticator App",
 *     createdAt: Date.now(),
 *   },
 * );
 * ```
 */
export const totpInsert = mutation({
  args: {
    userId: v.id("User"),
    secret: v.bytes(),
    digits: v.number(),
    period: v.number(),
    verified: v.boolean(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.id("TotpFactor"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("TotpFactor", args);
  },
});

/**
 * Get a verified TOTP enrollment for a user.
 *
 * Queries the `TotpFactor` table using the `user_id_verified` compound
 * index to find the first enrollment that has been successfully verified.
 * This is the primary lookup during a TOTP authentication challenge --
 * only verified enrollments should be used to validate codes.
 *
 * @param userId - The `_id` of the `User` whose verified TOTP enrollment
 *   to retrieve.
 * @returns The first verified `TotpFactor` document for the user, or
 *   `null` if the user has no verified TOTP enrollment.
 *
 * @example
 * ```ts
 * const totp = await ctx.runQuery(
 *   components.auth.factors.totp.totpGetVerifiedByUserId,
 *   { userId: user._id },
 * );
 * if (totp === null) {
 *   // User does not have TOTP 2FA enabled
 * }
 * ```
 */
export const totpGetVerifiedByUserId = query({
  args: { userId: v.id("User") },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("TotpFactor")
      .withIndex("user_id_verified", (q) => q.eq("userId", userId).eq("verified", true))
      .first();
  },
});

/**
 * List all TOTP enrollments for a user, both verified and unverified.
 *
 * Retrieves every `TotpFactor` document associated with the given user
 * via the `user_id` index. Useful for displaying enrolled authenticator
 * apps in a security settings page, including pending (unverified)
 * enrollments that the user has not yet confirmed.
 *
 * @param userId - The `_id` of the `User` whose TOTP enrollments to
 *   retrieve.
 * @returns An array of `TotpFactor` documents. Returns an empty array if
 *   the user has no TOTP enrollments.
 *
 * @example
 * ```ts
 * const factors = await ctx.runQuery(
 *   components.auth.factors.totp.totpListByUserId,
 *   { userId: user._id },
 * );
 * const verified = factors.filter((f) => f.verified);
 * const pending = factors.filter((f) => !f.verified);
 * ```
 */
export const totpListByUserId = query({
  args: { userId: v.id("User") },
  returns: v.array(vTotpFactorDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("TotpFactor")
      .withIndex("user_id", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Get a single TOTP enrollment by its document ID.
 *
 * Performs a direct document lookup on the `TotpFactor` table. This is
 * used when you already have the enrollment's `_id` (e.g. from a
 * previous list query) and need to fetch its full details, including
 * the secret and verification status.
 *
 * @param totpId - The `_id` of the `TotpFactor` document to retrieve.
 * @returns The `TotpFactor` document, or `null` if no enrollment exists
 *   with the given ID.
 *
 * @example
 * ```ts
 * const totp = await ctx.runQuery(
 *   components.auth.factors.totp.totpGetById,
 *   { totpId: enrollmentId },
 * );
 * if (totp !== null && !totp.verified) {
 *   // Enrollment is still pending confirmation
 * }
 * ```
 */
export const totpGetById = query({
  args: { totpId: v.id("TotpFactor") },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, { totpId }) => {
    return await ctx.db.get("TotpFactor", totpId);
  },
});

/**
 * Mark a TOTP enrollment as verified, completing the setup process.
 *
 * Called after the user successfully submits a valid TOTP code during
 * enrollment. This transitions the factor from a pending state to an
 * active, verified state, enabling it for future authentication
 * challenges.
 *
 * @param totpId - The `_id` of the `TotpFactor` document to mark as
 *   verified.
 * @param lastUsedAt - Unix timestamp (in milliseconds) recording when
 *   the verification code was successfully validated.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // After validating the user's TOTP code during setup
 * await ctx.runMutation(
 *   components.auth.factors.totp.totpMarkVerified,
 *   {
 *     totpId: enrollment._id,
 *     lastUsedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const totpMarkVerified = mutation({
  args: { totpId: v.id("TotpFactor"), lastUsedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch("TotpFactor", totpId, { verified: true, lastUsedAt });
    const factor = await ctx.db.get("TotpFactor", totpId);
    if (factor !== null) {
      const user = await ctx.db.get("User", factor.userId);
      if (user !== null && user.hasTotp !== true) {
        await ctx.db.patch("User", factor.userId, { hasTotp: true });
      }
    }
    return null;
  },
});

/**
 * Update a TOTP enrollment's last-used timestamp.
 *
 * Called after each successful TOTP code validation during sign-in.
 * Tracking the last-used time helps detect stale enrollments and can
 * be surfaced in security settings for user awareness.
 *
 * @param totpId - The `_id` of the `TotpFactor` document to update.
 * @param lastUsedAt - Unix timestamp (in milliseconds) recording when
 *   the TOTP code was most recently validated.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * await ctx.runMutation(
 *   components.auth.factors.totp.totpUpdateLastUsed,
 *   {
 *     totpId: totp._id,
 *     lastUsedAt: Date.now(),
 *   },
 * );
 * ```
 */
export const totpUpdateLastUsed = mutation({
  args: { totpId: v.id("TotpFactor"), lastUsedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { totpId, lastUsedAt }) => {
    await ctx.db.patch("TotpFactor", totpId, { lastUsedAt });
    return null;
  },
});

/**
 * Delete a TOTP enrollment from the `TotpFactor` table.
 *
 * Permanently removes the TOTP factor record, including its shared
 * secret. After deletion the user can no longer use this factor for
 * two-factor authentication. Typically called when a user disables
 * TOTP 2FA or wants to re-enroll with a new secret.
 *
 * @param totpId - The `_id` of the `TotpFactor` document to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // User disables TOTP 2FA
 * await ctx.runMutation(
 *   components.auth.factors.totp.totpDelete,
 *   { totpId: totp._id },
 * );
 * ```
 */
export const totpDelete = mutation({
  args: { totpId: v.id("TotpFactor") },
  returns: v.null(),
  handler: async (ctx, { totpId }) => {
    const factor = await ctx.db.get("TotpFactor", totpId);
    await ctx.db.delete("TotpFactor", totpId);
    if (factor !== null && factor.verified) {
      const remaining = await ctx.db
        .query("TotpFactor")
        .withIndex("user_id_verified", (q) => q.eq("userId", factor.userId).eq("verified", true))
        .first();
      if (remaining === null) {
        const user = await ctx.db.get("User", factor.userId);
        if (user !== null && user.hasTotp === true) {
          await ctx.db.patch("User", factor.userId, { hasTotp: false });
        }
      }
    }
    return null;
  },
});

// ============================================================================
// Rate Limits
// ============================================================================
