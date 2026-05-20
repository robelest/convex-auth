import { ConvexError, v } from "convex/values";

import { mutation, query } from "../../functions";
import { vAccountDoc } from "../../model";

/**
 * List all accounts linked to a specific user.
 *
 * Queries the `Account` table using the `user_id_provider` index to efficiently
 * retrieve every authentication account (e.g. OAuth, credentials, email) that
 * belongs to the given user.
 *
 * @param args.userId - The document ID of the user whose accounts should be retrieved.
 * @returns An array of account documents associated with the user. Each document
 *   includes fields such as `provider`, `providerAccountId`, `secret`, and `extend`.
 *
 */
export const accountList = query({
  args: { userId: v.id("User") },
  returns: v.array(vAccountDoc),
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("Account")
      .withIndex("user_id_provider", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Read an account by identity — one function, all-optional args, unioned
 * return: `{ id }` (point lookup) or `{ provider, providerAccountId }`
 * (unique provider index).
 */
export const accountGet = query({
  args: {
    id: v.optional(v.id("Account")),
    provider: v.optional(v.string()),
    providerAccountId: v.optional(v.string()),
  },
  returns: v.union(vAccountDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.provider !== undefined && args.providerAccountId !== undefined) {
      return await ctx.db
        .query("Account")
        .withIndex("provider_account_id", (q) =>
          q.eq("provider", args.provider!).eq("providerAccountId", args.providerAccountId!),
        )
        .unique();
    }
    if (args.id === undefined) return null;
    return await ctx.db.get("Account", args.id);
  },
});

/**
 * Create a new account that links a user to an authentication provider.
 *
 * Inserts a row into the `Account` table, establishing the relationship between
 * a user document and an external authentication provider (OAuth, credentials,
 * email/phone OTP, etc.). A single user may have multiple accounts for different
 * providers.
 *
 * @param args.userId - The document ID of the user to link this account to.
 * @param args.provider - The name of the authentication provider (e.g. `"google"`, `"credentials"`).
 * @param args.providerAccountId - The unique identifier for this user within the external provider.
 * @param args.secret - An optional hashed secret (e.g. password hash) stored for credential-based providers.
 * @param args.extend - Optional arbitrary data to store alongside the account for application-specific needs.
 * @returns The document ID of the newly created account.
 *
 */
export const accountInsert = mutation({
  args: {
    userId: v.id("User"),
    provider: v.string(),
    providerAccountId: v.string(),
    secret: v.optional(v.string()),
    extend: v.optional(v.any()),
  },
  returns: v.id("Account"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("Account", args);
  },
});

/**
 * Patch an existing account document with partial data.
 *
 * Merges the provided fields into the existing account document. Fields not
 * included in `data` are left unchanged. This is useful for updating a stored
 * secret (e.g. after a password change) or modifying extended metadata.
 *
 * @param args.accountId - The document ID of the account to update.
 * @param args.data - A partial object containing the fields to merge into the account document.
 * @returns `null` on success.
 *
 */
export const accountPatch = mutation({
  args: { accountId: v.id("Account"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { accountId, data }) => {
    await ctx.db.patch("Account", accountId, data);
    return null;
  },
});

/**
 * Delete an account document permanently.
 *
 * Removes the account from the `Account` table. This effectively unlinks the
 * user from the corresponding authentication provider. Callers should ensure
 * that related resources (verification codes, sessions, etc.) are cleaned up
 * separately if needed.
 *
 * @param args.accountId - The document ID of the account to delete.
 * @returns `null` on success.
 *
 */
export const accountDelete = mutation({
  args: {
    accountId: v.id("Account"),
    /**
     * When true, atomically verifies that the owning user has at least one
     * other account remaining before deleting. Throws `ACCOUNT_NOT_FOUND`
     * if the account doesn't exist, or `INVALID_PARAMETERS` if it's the
     * only account on the user. Collapses what the app side previously
     * did in three RPCs (get account → list all by user → delete) into a
     * single atomic mutation.
     */
    requireOtherAccount: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { accountId, requireOtherAccount }) => {
    if (requireOtherAccount === true) {
      const doc = await ctx.db.get("Account", accountId);
      if (doc === null) {
        throw new ConvexError({
          code: "ACCOUNT_NOT_FOUND",
          message: "Account not found.",
        });
      }
      let otherFound = false;
      for await (const sibling of ctx.db
        .query("Account")
        .withIndex("user_id_provider", (q) => q.eq("userId", doc.userId))) {
        if (sibling._id !== accountId) {
          otherFound = true;
          break;
        }
      }
      if (!otherFound) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "The provided parameters are invalid.",
        });
      }
    }
    await ctx.db.delete("Account", accountId);
    return null;
  },
});

// ============================================================================
// Sessions
// ============================================================================
