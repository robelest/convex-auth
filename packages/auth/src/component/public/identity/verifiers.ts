import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vAuthVerifierDoc } from "../../model";

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
 * @example
 * ```ts
 * const verifierId = await ctx.runMutation(
 *   component.identity.verifiers.verifierCreate,
 *   { sessionId: session._id },
 * );
 * ```
 */
export const verifierCreate = mutation({
  args: {
    sessionId: v.optional(v.id("Session")),
    signature: v.optional(v.string()),
  },
  returns: v.id("AuthVerifier"),
  handler: async (ctx, { sessionId, signature }) => {
    return await ctx.db.insert("AuthVerifier", {
      sessionId: sessionId as any,
      signature,
    });
  },
});

/**
 * Retrieve a single verifier by its Convex document ID.
 *
 * Performs a direct point lookup on the `AuthVerifier` table. Returns `null` if
 * the verifier has been deleted or never existed.
 *
 * @param args.verifierId - The Convex document ID (`Id<"AuthVerifier">`) of the verifier to retrieve.
 * @returns The verifier document if it exists, or `null` otherwise.
 *
 * @example
 * ```ts
 * const verifier = await ctx.runQuery(
 *   component.identity.verifiers.verifierGetById,
 *   { verifierId: storedVerifierId },
 * );
 * if (verifier !== null) {
 *   console.log(`Verifier signature: ${verifier.signature}`);
 * }
 * ```
 */
export const verifierGetById = query({
  args: { verifierId: v.id("AuthVerifier") },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { verifierId }) => {
    return await ctx.db.get("AuthVerifier", verifierId);
  },
});

/**
 * Look up a verifier by its cryptographic signature.
 *
 * Queries the `AuthVerifier` table using the `signature` index to find the
 * unique verifier matching the given signature string. This is the primary
 * lookup used during the OAuth callback phase to correlate the incoming
 * authorization response with the original PKCE challenge.
 *
 * @param args.signature - The cryptographic signature string to search for (exact match).
 * @returns The matching verifier document, or `null` if no verifier has the given signature.
 *
 * @example
 * ```ts
 * const verifier = await ctx.runQuery(
 *   component.identity.verifiers.verifierGetBySignature,
 *   { signature: incomingStateParam },
 * );
 * if (verifier === null) {
 *   throw new Error("Invalid or expired OAuth state");
 * }
 * ```
 */
export const verifierGetBySignature = query({
  args: { signature: v.string() },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, { signature }) => {
    return await ctx.db
      .query("AuthVerifier")
      .withIndex("signature", (q) => q.eq("signature", signature))
      .unique();
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
 * @example
 * ```ts
 * // Set the PKCE signature on the verifier
 * await ctx.runMutation(
 *   component.identity.verifiers.verifierPatch,
 *   {
 *     verifierId: verifier._id,
 *     data: { signature: generatedSignature },
 *   },
 * );
 * ```
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
 * @example
 * ```ts
 * // Clean up the verifier after a successful OAuth exchange
 * await ctx.runMutation(
 *   component.identity.verifiers.verifierDelete,
 *   { verifierId: verifier._id },
 * );
 * ```
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
