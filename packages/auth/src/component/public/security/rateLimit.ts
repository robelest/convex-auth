/**
 * Sign-in rate-limit helpers built on `@convex-dev/rate-limiter`.
 *
 * The {@link RateLimiter} class binds to `components.rateLimiter`, which is
 * mounted only inside the auth component. The library's parent-side code
 * (`server/limits.ts`) calls these helpers via `ctx.runQuery`/`runMutation`
 * to perform the check/limit/reset.
 *
 * Token-bucket semantics: `rate` is the steady-state refill rate per hour;
 * an identifier can absorb a burst of up to `rate` failures, then must wait
 * for refill. Successful sign-ins reset the bucket to full.
 *
 * @module
 */

import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";

import { components } from "../../_generated/api";
import { mutation, query } from "../../functions";

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

export const signInReset = mutation({
  args: { identifier: v.string() },
  returns: v.null(),
  handler: async (ctx, { identifier }) => {
    await new RateLimiter(components.rateLimiter).reset(ctx, "signIn", { key: identifier });
    return null;
  },
});
