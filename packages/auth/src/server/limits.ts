import { Fx } from "@robelest/fx";
import { ConvexError } from "convex/values";

import { authDb } from "./db";
import { Doc, MutationCtx } from "./types";
import { ConvexAuthConfig } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Check whether the given identifier is currently rate-limited.
 */
/** @internal */
export const isSignInRateLimited = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<boolean, ConvexError<any>> =>
  getRateLimitState(ctx, identifier, config).pipe(
    Fx.map((state) => state !== null && state.attemptsLeft < 1),
  );

/**
 * Record a failed sign-in attempt for the given identifier.
 *
 * If a record exists, decrement; otherwise create.
 */
/** @internal */
export const recordFailedSignIn = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<void, ConvexError<any>> =>
  Fx.gen(function* () {
    const state = yield* getRateLimitState(ctx, identifier, config);
    if (state !== null) {
      yield* Fx.promise(() =>
        authDb(ctx, config).rateLimits.patch(state.limit._id, {
          attemptsLeft: state.attemptsLeft - 1,
          lastAttemptTime: Date.now(),
        }),
      );
    } else {
      yield* Fx.promise(() =>
        authDb(ctx, config).rateLimits.create({
          identifier,
          attemptsLeft:
            (config.signIn?.maxFailedAttemptsPerHour ??
              DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR) - 1,
          lastAttemptTime: Date.now(),
        }),
      );
    }
  });

/**
 * Reset the rate limit for the given identifier (e.g. after successful sign-in).
 */
/** @internal */
export const resetSignInRateLimit = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<void, ConvexError<any>> =>
  Fx.gen(function* () {
    const state = yield* getRateLimitState(ctx, identifier, config);
    if (state !== null) {
      yield* Fx.promise(() =>
        authDb(ctx, config).rateLimits.delete(state.limit._id),
      );
    }
  });

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

type RateLimitState = {
  limit: Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number };
  attemptsLeft: number;
} | null;

const getRateLimitState = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<RateLimitState, ConvexError<any>> =>
  Fx.gen(function* () {
    const now = Date.now();
    const maxAttemptsPerHour =
      config.signIn?.maxFailedAttemptsPerHour ??
      DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;

    const limit = (yield* Fx.promise(() =>
      authDb(ctx, config).rateLimits.get(identifier),
    )) as
      | (Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number })
      | null;
    if (limit === null) return null;
    const elapsed = now - limit.lastAttemptTime;
    const maxAttemptsPerMs = maxAttemptsPerHour / (60 * 60 * 1000);
    const attemptsLeft = Math.min(
      maxAttemptsPerHour,
      limit.attemptsLeft + elapsed * maxAttemptsPerMs,
    );
    return { limit, attemptsLeft };
  });
