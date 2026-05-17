import { v } from "convex/values";

import type { QueryCtx } from "../../_generated/server";
import { mutation, query } from "../../functions";
import { vAuthVerifierDoc } from "../../model";

const DEFAULT_VERIFIER_TTL_MS = 1000 * 60 * 15;

async function getUnexpiredVerifier(ctx: QueryCtx, verifierId: string) {
  const verifier = await ctx.db.get("AuthVerifier", verifierId as any);
  if (verifier?.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
    return null;
  }
  return verifier;
}

/**
 * Create a new PKCE verifier, optionally linked to a session.
 *
 * Inserts a document into the `AuthVerifier` table. Verifiers are used during
 * OAuth/OIDC flows to implement the PKCE (Proof Key for Code Exchange) pattern,
 * preventing authorization code interception attacks. The verifier can optionally
 * be linked to an existing session for session-aware flows.
 *
 * @param args.sessionId - An optional session document ID to associate with the verifier.
 *   When provided, the verifier is scoped to the given session.
 * @returns The document ID of the newly created verifier.
 *
 */
export const verifierCreate = mutation({
  args: {
    sessionId: v.optional(v.id("Session")),
    signature: v.optional(v.string()),
    expirationTime: v.optional(v.number()),
  },
  returns: v.id("AuthVerifier"),
  handler: async (ctx, { sessionId, signature, expirationTime }) => {
    return await ctx.db.insert("AuthVerifier", {
      sessionId: sessionId as any,
      signature,
      expirationTime: expirationTime ?? Date.now() + DEFAULT_VERIFIER_TTL_MS,
    });
  },
});

/**
 * Read a verifier by identity — one function, all-optional args, unioned
 * return: `{ id }` (point lookup) or `{ signature }` (unique index).
 * Expiry enforced for both.
 */
export const verifierGet = query({
  args: {
    id: v.optional(v.id("AuthVerifier")),
    signature: v.optional(v.string()),
  },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.signature !== undefined) {
      const verifier = await ctx.db
        .query("AuthVerifier")
        .withIndex("signature", (q) => q.eq("signature", args.signature!))
        .unique();
      if (verifier?.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
        return null;
      }
      return verifier;
    }
    if (args.id === undefined) return null;
    return await getUnexpiredVerifier(ctx, args.id);
  },
});

/**
 * Patch a verifier document with partial data.
 *
 * Merges the provided fields into the existing verifier document. This is
 * typically used to set the `signature` field after the verifier is initially
 * created, or to associate a `sessionId` with an existing verifier.
 *
 * @param args.verifierId - The document ID of the verifier to update.
 * @param args.data - A partial object containing the fields to merge into the verifier document
 *   (e.g. `{ signature: string }` or `{ sessionId: Id<"Session"> }`).
 * @returns `null` on success.
 *
 */
export const verifierPatch = mutation({
  args: { verifierId: v.id("AuthVerifier"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { verifierId, data }) => {
    await ctx.db.patch("AuthVerifier", verifierId, data);
    return null;
  },
});

/**
 * Delete a verifier document permanently.
 *
 * Removes the verifier from the `AuthVerifier` table. This is typically called
 * after a successful OAuth callback to clean up the consumed PKCE state, or
 * to expire stale verifiers that were never completed.
 *
 * @param args.verifierId - The document ID of the verifier to delete.
 * @returns `null` on success.
 *
 */
export const verifierDelete = mutation({
  args: { verifierId: v.id("AuthVerifier") },
  returns: v.null(),
  handler: async (ctx, { verifierId }) => {
    await ctx.db.delete("AuthVerifier", verifierId);
    return null;
  },
});

// ============================================================================
// Verification Codes
// ============================================================================
