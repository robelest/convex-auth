/**
 * `component.token.verification.*` — OTP / magic-link / OAuth codes.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { v } from "convex/values";

import { mutation, query } from "../functions";
import { vVerificationCodeDoc } from "../model";

/**
 * Read a verification code by raw `code` or by `accountId`.
 * Accepts exactly one selector.
 */
export const get = query({
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
    return await getOneFrom(ctx.db, "VerificationCode", "account_id", args.accountId, "accountId");
  },
});

/** Create a verification code for an account. Returns the new id. */
export const create = mutation({
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
    return await ctx.db.insert("VerificationCode", args);
  },
});

/** Delete a verification code by id. */
const remove = mutation({
  args: { id: v.id("VerificationCode") },
  returns: v.null(),
  handler: async (ctx, { id: verificationCodeId }) => {
    await ctx.db.delete("VerificationCode", verificationCodeId);
    return null;
  },
});

export { remove };
