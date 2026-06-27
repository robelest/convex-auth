/**
 * `component.token.pkce.*` — PKCE verifiers.
 *
 * Reads collapse into one overloaded `get`.
 *
 * @module
 */

import { getOneFrom } from "convex-helpers/server/relationships";
import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { mutation, query } from "../functions";
import { vAuthVerifierDoc } from "../model";

const DEFAULT_VERIFIER_TTL_MS = 1000 * 60 * 15;

async function getUnexpiredVerifier(ctx: QueryCtx, verifierId: string) {
  const verifier = await ctx.db.get("AuthVerifier", verifierId as Id<"AuthVerifier">);
  if (verifier?.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
    return null;
  }
  return verifier;
}

/**
 * Read a verifier by `id` or `signature`, returning `null` once expired.
 * Accepts exactly one selector.
 */
export const get = query({
  args: {
    id: v.optional(v.id("AuthVerifier")),
    signature: v.optional(v.string()),
  },
  returns: v.union(vAuthVerifierDoc, v.null()),
  handler: async (ctx, args) => {
    if (args.signature !== undefined) {
      const verifier = await getOneFrom(ctx.db, "AuthVerifier", "signature", args.signature);
      if (verifier?.expirationTime !== undefined && verifier.expirationTime < Date.now()) {
        return null;
      }
      return verifier;
    }
    if (args.id === undefined) return null;
    return await getUnexpiredVerifier(ctx, args.id);
  },
});

/** Create a PKCE verifier, defaulting `expirationTime` to 15 minutes out. */
export const create = mutation({
  args: {
    sessionId: v.optional(v.id("Session")),
    signature: v.optional(v.string()),
    expirationTime: v.optional(v.number()),
  },
  returns: v.id("AuthVerifier"),
  handler: async (ctx, { sessionId, signature, expirationTime }) => {
    return await ctx.db.insert("AuthVerifier", {
      sessionId: sessionId,
      signature,
      expirationTime: expirationTime ?? Date.now() + DEFAULT_VERIFIER_TTL_MS,
    });
  },
});

/** Patch a verifier in place. */
export const update = mutation({
  args: {
    id: v.id("AuthVerifier"),
    patch: v.object({
      sessionId: v.optional(v.id("Session")),
      signature: v.optional(v.string()),
      expirationTime: v.optional(v.number()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { id: verifierId, patch }) => {
    await ctx.db.patch("AuthVerifier", verifierId, patch);
    return null;
  },
});

/** Delete a verifier by id. */
const remove = mutation({
  args: { id: v.id("AuthVerifier") },
  returns: v.null(),
  handler: async (ctx, { id: verifierId }) => {
    await ctx.db.delete("AuthVerifier", verifierId);
    return null;
  },
});

export { remove };
