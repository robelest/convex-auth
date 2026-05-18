import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vVerificationCodeDoc } from "../../model";

/**
 * Read a verification code by identity — one function, all-optional
 * args, unioned return: `{ accountId }` (unique per account) or
 * `{ code }` (code index).
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
