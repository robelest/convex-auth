/**
 * `component.limits.*` — sign-in rate-limit helpers backed by
 * `@convex-dev/rate-limiter`.
 *
 * @module
 */

import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./functions";

function makeLimiter(rate: number) {
  return new RateLimiter(components.rateLimiter, {
    signIn: { kind: "token bucket", rate, period: HOUR },
  });
}

const args = {
  identifier: v.string(),
  maxAttemptsPerHour: v.number(),
};

const returns = v.object({
  ok: v.boolean(),
  retryAfter: v.optional(v.number()),
});

/** Peek at sign-in rate-limit headroom for `identifier` without consuming a token. */
export const signInCheck = query({
  args,
  returns,
  handler: async (ctx, { identifier, maxAttemptsPerHour }) => {
    const result = await makeLimiter(maxAttemptsPerHour).check(ctx, "signIn", {
      key: identifier,
    });
    return { ok: result.ok, retryAfter: result.retryAfter };
  },
});

/** Consume one sign-in token for `identifier`; `ok: false` with `retryAfter` when throttled. */
export const signInRecord = mutation({
  args,
  returns,
  handler: async (ctx, { identifier, maxAttemptsPerHour }) => {
    const result = await makeLimiter(maxAttemptsPerHour).limit(ctx, "signIn", {
      key: identifier,
    });
    return { ok: result.ok, retryAfter: result.retryAfter };
  },
});

/** Clear the sign-in rate-limit counter for `identifier` (e.g. after success). */
export const signInReset = mutation({
  args: { identifier: v.string() },
  returns: v.null(),
  handler: async (ctx, { identifier }) => {
    await new RateLimiter(components.rateLimiter).reset(ctx, "signIn", { key: identifier });
    return null;
  },
});
