import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vVerificationCodeDoc } from "../../model";

/**
 * Find a verification code by its associated account ID.
 *
 * Queries the `VerificationCode` table using the `account_id` index to locate
 * the unique verification code linked to the given account. Each account has at
 * most one active verification code at a time.
 *
 * @param args.accountId - The document ID of the account whose verification code should be retrieved.
 * @returns The verification code document if one exists for the account, or `null` otherwise.
 *
 * @example
 * ```ts
 * const code = await ctx.runQuery(
 *   component.identity.codes.verificationCodeGetByAccountId,
 *   { accountId: account._id },
 * );
 * if (code !== null && code.expirationTime > Date.now()) {
 *   console.log("Active verification code exists");
 * }
 * ```
 */
/**
 * Read a verification code by identity — one function, all-optional
 * args, unioned return: `{ accountId }` (unique per account) or
 * `{ code }` (code index). Replaces `verificationCodeGetByAccountId` /
 * `verificationCodeGetByCode`.
 */
export const verificationCodeGet = query({
  args: {
    accountId: v.optional(v.id("Account")),
    code: v.optional(v.string()),
  },
  returns: v.union(vVerificationCodeDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.code !== undefined) {
      return await ctx.db
        .query("VerificationCode")
        .withIndex("code", (q) => q.eq("code", args.code!))
        .first();
    }
    if (args.accountId === undefined) return null;
    return await ctx.db
      .query("VerificationCode")
      .withIndex("account_id", (q) => q.eq("accountId", args.accountId! as any))
      .unique();
  },
});

/**
 * Create a new verification code for OTP, magic link, or OAuth flows.
 *
 * Inserts a document into the `VerificationCode` table that ties a short-lived
 * code to a specific account and provider. The code can be used for email OTP,
 * phone OTP, magic link, or OAuth state verification depending on the flow.
 *
 * @param args.accountId - The document ID of the account this verification code is associated with.
 * @param args.provider - The name of the authentication provider initiating the verification
 *   (e.g. `"resend-otp"`, `"twilio-otp"`, `"google"`).
 * @param args.code - The verification code string (e.g. a random OTP or an opaque token for magic links).
 * @param args.expirationTime - The Unix timestamp (in milliseconds) at which this code expires.
 * @param args.verifier - An optional PKCE verifier string used in OAuth/OIDC flows to prevent CSRF attacks.
 * @param args.emailVerified - An optional email address that will be marked as verified upon successful
 *   code redemption.
 * @param args.phoneVerified - An optional phone number that will be marked as verified upon successful
 *   code redemption.
 * @returns The document ID of the newly created verification code.
 *
 * @example
 * ```ts
 * const codeId = await ctx.runMutation(
 *   component.identity.codes.verificationCodeCreate,
 *   {
 *     accountId: account._id,
 *     provider: "resend-otp",
 *     code: "482910",
 *     expirationTime: Date.now() + 10 * 60 * 1000, // 10 minutes
 *     emailVerified: "alice@example.com",
 *   },
 * );
 * ```
 */
export const verificationCodeCreate = mutation({
  args: {
    accountId: v.id("Account"),
    provider: v.string(),
    code: v.string(),
    expirationTime: v.number(),
    verifier: v.optional(v.string()),
    emailVerified: v.optional(v.string()),
    phoneVerified: v.optional(v.string()),
  },
  returns: v.id("VerificationCode"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("VerificationCode", args as any);
  },
});

/**
 * Delete a verification code document permanently.
 *
 * Removes the verification code from the `VerificationCode` table. This is
 * typically called after the code has been successfully redeemed or when it
 * needs to be invalidated (e.g. replaced by a new code).
 *
 * @param args.verificationCodeId - The document ID of the verification code to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // Delete the code after successful verification
 * await ctx.runMutation(
 *   component.identity.codes.verificationCodeDelete,
 *   { verificationCodeId: codeDoc._id },
 * );
 * ```
 */
export const verificationCodeDelete = mutation({
  args: { verificationCodeId: v.id("VerificationCode") },
  returns: v.null(),
  handler: async (ctx, { verificationCodeId }) => {
    await ctx.db.delete("VerificationCode", verificationCodeId);
    return null;
  },
});

// ============================================================================
// Refresh Tokens
// ============================================================================
