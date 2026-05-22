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
 * Read a TOTP enrollment by identity.
 *
 * Accepts exactly one selector:
 * - `id` — direct document lookup by `TotpFactor` `_id`.
 * - `verifiedForUserId` — the first verified enrollment for the given
 *   user, via the `user_id_verified` compound index. This is the primary
 *   lookup during a TOTP authentication challenge, since only verified
 *   enrollments may validate codes.
 *
 * @param id - Optional `_id` of the `TotpFactor` document to retrieve.
 * @param verifiedForUserId - Optional `_id` of the `User` whose first
 *   verified enrollment to retrieve.
 * @returns The matching `TotpFactor` document, or `null` if none matches.
 *
 */
export const totpGet = query({
  args: {
    id: v.optional(v.id("TotpFactor")),
    verifiedForUserId: v.optional(v.id("User")),
  },
  returns: v.union(vTotpFactorDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.verifiedForUserId !== undefined) {
      return await ctx.db
        .query("TotpFactor")
        .withIndex("user_id_verified", (q) =>
          q.eq("userId", args.verifiedForUserId!).eq("verified", true),
        )
        .first();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("TotpFactor", args.id);
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
 */
export const totpList = query({
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
 * Partially update a TOTP enrollment.
 *
 * Performs a partial patch on the `TotpFactor` document. Used to confirm
 * an enrollment (`{ verified: true, lastUsedAt }`) and to bump
 * `lastUsedAt` after each successful validation (stale-enrollment
 * tracking).
 *
 * @param totpId - The `_id` of the `TotpFactor` document to update.
 * @param data - An object containing the fields to patch.
 * @returns `null` on success.
 *
 */
export const totpUpdate = mutation({
  args: {
    totpId: v.id("TotpFactor"),
    data: v.object({
      verified: v.optional(v.boolean()),
      name: v.optional(v.string()),
      lastUsedAt: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { totpId, data }) => {
    await ctx.db.patch("TotpFactor", totpId, data);
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
 */
export const totpDelete = mutation({
  args: { totpId: v.id("TotpFactor") },
  returns: v.null(),
  handler: async (ctx, { totpId }) => {
    await ctx.db.delete("TotpFactor", totpId);
    return null;
  },
});

// ============================================================================
// Rate Limits
// ============================================================================
