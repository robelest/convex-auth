import { v } from "convex/values";

import { mutation, query } from "../../functions";
import { vRateLimitResult } from "../../model";

/**
 * Look up a rate limit entry by its string identifier.
 *
 * Queries the `RateLimit` table using the `by_identifier` unique index.
 * Returns the rate limit state with camelCase field names (`attemptsLeft`,
 * `lastAttemptTime`) mapped from the snake_case storage format. Used to
 * check whether an action should be allowed or throttled.
 *
 * @param identifier - Unique string identifying the rate limit bucket
 *   (e.g. `"login:user@example.com"` or `"api:sk_live_abc123"`).
 * @returns The rate limit state object (including `attemptsLeft` and
 *   `lastAttemptTime`), or `null` if no entry exists for the identifier.
 *
 * @example
 * ```ts
 * const limit = await ctx.runQuery(
 *   components.auth.security.limits.rateLimitGet,
 *   { identifier: `login:${email}` },
 * );
 * if (limit !== null && limit.attemptsLeft <= 0) {
 *   throw new Error("Too many login attempts. Please try again later.");
 * }
 * ```
 */
export const rateLimitGet = query({
  args: { identifier: v.string() },
  returns: v.union(vRateLimitResult, v.null()),
  handler: async (ctx, { identifier }) => {
    const row = await ctx.db
      .query("RateLimit")
      .withIndex("by_identifier", (q) => q.eq("identifier", identifier))
      .unique();
    if (row === null) {
      return null;
    }
    return {
      ...row,
      attemptsLeft: row.attempts_left,
      lastAttemptTime: row.last_attempt_time,
    };
  },
});

/**
 * Create a new rate limit entry in the `RateLimit` table.
 *
 * Initializes a rate limit bucket for a given identifier. The entry
 * tracks remaining attempts and the timestamp of the last attempt,
 * storing them in snake_case format internally. Call this when the
 * first rate-limited action occurs for an identifier that does not
 * yet have an entry.
 *
 * @param identifier - Unique string identifying the rate limit bucket
 *   (e.g. `"login:user@example.com"` or `"otp:+15551234567"`).
 * @param attemptsLeft - Number of remaining attempts before the action
 *   is throttled.
 * @param lastAttemptTime - Unix timestamp (in milliseconds) of the
 *   initial attempt.
 * @returns The `_id` of the newly created `RateLimit` document.
 *
 * @example
 * ```ts
 * const rateLimitId = await ctx.runMutation(
 *   components.auth.security.limits.rateLimitCreate,
 *   {
 *     identifier: `login:${email}`,
 *     attemptsLeft: 4, // 5 max minus this attempt
 *     lastAttemptTime: Date.now(),
 *   },
 * );
 * ```
 */
export const rateLimitCreate = mutation({
  args: {
    identifier: v.string(),
    attemptsLeft: v.number(),
    lastAttemptTime: v.number(),
  },
  returns: v.id("RateLimit"),
  handler: async (ctx, { identifier, attemptsLeft, lastAttemptTime }) => {
    return await ctx.db.insert("RateLimit", {
      identifier,
      attempts_left: attemptsLeft,
      last_attempt_time: lastAttemptTime,
    });
  },
});

/**
 * Patch a rate limit entry with partial data.
 *
 * Updates an existing `RateLimit` document with the provided fields.
 * Automatically maps camelCase field names (`attemptsLeft`,
 * `lastAttemptTime`) to the snake_case storage format before writing.
 * Typically called to decrement remaining attempts or to reset the
 * bucket after a cooldown window has elapsed.
 *
 * @param rateLimitId - The `_id` of the `RateLimit` document to update.
 * @param data - An object containing the fields to patch. Supports
 *   camelCase names which are transparently converted:
 *   - `attemptsLeft` -- Updated number of remaining attempts.
 *   - `lastAttemptTime` -- Updated timestamp of the most recent attempt.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // Decrement attempts after a failed login
 * await ctx.runMutation(
 *   components.auth.security.limits.rateLimitPatch,
 *   {
 *     rateLimitId: limit._id,
 *     data: {
 *       attemptsLeft: limit.attemptsLeft - 1,
 *       lastAttemptTime: Date.now(),
 *     },
 *   },
 * );
 * ```
 */
export const rateLimitPatch = mutation({
  args: { rateLimitId: v.id("RateLimit"), data: v.any() },
  returns: v.null(),
  handler: async (ctx, { rateLimitId, data }) => {
    const nextData: Record<string, unknown> = { ...data };
    if (nextData.attemptsLeft !== undefined) {
      nextData.attempts_left = nextData.attemptsLeft;
      delete nextData.attemptsLeft;
    }
    if (nextData.lastAttemptTime !== undefined) {
      nextData.last_attempt_time = nextData.lastAttemptTime;
      delete nextData.lastAttemptTime;
    }
    await ctx.db.patch("RateLimit", rateLimitId, nextData);
    return null;
  },
});

/**
 * Delete a rate limit entry from the `RateLimit` table.
 *
 * Permanently removes the rate limit bucket. This effectively resets
 * rate limiting for the associated identifier, allowing the next
 * action to proceed without throttling. Useful for administrative
 * resets or cleanup of expired buckets.
 *
 * @param rateLimitId - The `_id` of the `RateLimit` document to delete.
 * @returns `null` on success.
 *
 * @example
 * ```ts
 * // Admin resets a user's login rate limit
 * await ctx.runMutation(
 *   components.auth.security.limits.rateLimitDelete,
 *   { rateLimitId: limit._id },
 * );
 * ```
 */
export const rateLimitDelete = mutation({
  args: { rateLimitId: v.id("RateLimit") },
  returns: v.null(),
  handler: async (ctx, { rateLimitId }) => {
    await ctx.db.delete("RateLimit", rateLimitId);
    return null;
  },
});

// ============================================================================
// Device Authorization (RFC 8628)
// ============================================================================
