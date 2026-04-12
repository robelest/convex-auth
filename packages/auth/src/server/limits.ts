import { Effect } from "effect";

import { authDb } from "./db";
import type { ConvexAuthConfig, Doc, MutationCtx } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Check whether the given identifier is currently rate-limited.
 * @internal
 */
export const isSignInRateLimited = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Effect.Effect<boolean> =>
  Effect.map(getRateLimitState(ctx, identifier, config), (state) => {
    return state !== null && state.attemptsLeft < 1;
  });

/**
 * Record a failed sign-in attempt for the given identifier.
 * @internal
 */
export const recordFailedSignIn = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Effect.Effect<void> =>
  Effect.flatMap(getRateLimitState(ctx, identifier, config), (state) =>
    state !== null
      ? Effect.promise(() =>
          authDb(ctx, config).rateLimits.patch(state.limit._id, {
            attemptsLeft: state.attemptsLeft - 1,
            lastAttemptTime: Date.now(),
          }),
        )
      : Effect.promise(() =>
          authDb(ctx, config).rateLimits.create({
            identifier,
            attemptsLeft:
              (config.signIn?.maxFailedAttemptsPerHour ??
                DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR) - 1,
            lastAttemptTime: Date.now(),
          }),
        ).pipe(Effect.asVoid),
  );

/**
 * Reset the rate limit for the given identifier.
 * @internal
 */
export const resetSignInRateLimit = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Effect.Effect<void> =>
  Effect.flatMap(getRateLimitState(ctx, identifier, config), (state) =>
    state !== null
      ? Effect.promise(() => authDb(ctx, config).rateLimits.delete(state.limit._id))
      : Effect.void,
  );

type RateLimitState = {
  limit: Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number };
  attemptsLeft: number;
} | null;

const getRateLimitState = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Effect.Effect<RateLimitState> =>
  Effect.map(
    Effect.promise(() => authDb(ctx, config).rateLimits.get(identifier)),
    (limit) => {
      const typedLimit = limit as
        | (Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number })
        | null;
      if (typedLimit === null) {
        return null;
      }
      const now = Date.now();
      const maxAttemptsPerHour =
        config.signIn?.maxFailedAttemptsPerHour ??
        DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;
      const elapsed = now - typedLimit.lastAttemptTime;
      const maxAttemptsPerMs = maxAttemptsPerHour / (60 * 60 * 1000);
      const attemptsLeft = Math.min(
        maxAttemptsPerHour,
        typedLimit.attemptsLeft + elapsed * maxAttemptsPerMs,
      );
      return { limit: typedLimit, attemptsLeft };
    },
  );
