import { Fx } from "@robelest/fx";

import { authDb } from "./db";
import { AuthError } from "./authError";
import { Doc, MutationCtx } from "./types";
import { ConvexAuthConfig } from "./types";
import { errorMessage } from "./utils";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Check whether the given identifier is currently rate-limited.
 */
/** @internal */
export const isSignInRateLimited = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<boolean, AuthError> =>
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
): Fx<void, AuthError> =>
  getRateLimitState(ctx, identifier, config).pipe(
    Fx.chain((state) =>
      state !== null
        ? Fx.from({
            ok: () =>
              authDb(ctx, config).rateLimits.patch(state.limit._id, {
                attemptsLeft: state.attemptsLeft - 1,
                lastAttemptTime: Date.now(),
              }),
            err: (e) =>
              new AuthError(
                "INTERNAL_ERROR",
                `Failed to patch rate limit: ${errorMessage(e)}`,
              ),
          })
        : Fx.from({
            ok: () =>
              authDb(ctx, config).rateLimits.create({
                identifier,
                attemptsLeft:
                  (config.signIn?.maxFailedAttemptsPerHour ??
                    DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR) - 1,
                lastAttemptTime: Date.now(),
              }),
            err: (e) =>
              new AuthError(
                "INTERNAL_ERROR",
                `Failed to create rate limit: ${errorMessage(e)}`,
              ),
          }),
    ),
    Fx.map(() => undefined),
  );

/**
 * Reset the rate limit for the given identifier (e.g. after successful sign-in).
 */
/** @internal */
export const resetSignInRateLimit = (
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Fx<void, AuthError> =>
  getRateLimitState(ctx, identifier, config).pipe(
    Fx.chain((state) =>
      state !== null
        ? Fx.from({
            ok: () => authDb(ctx, config).rateLimits.delete(state.limit._id),
            err: (e) =>
              new AuthError(
                "INTERNAL_ERROR",
                `Failed to delete rate limit: ${errorMessage(e)}`,
              ),
          })
        : Fx.unit,
    ),
  );

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
): Fx<RateLimitState, AuthError> => {
  const now = Date.now();
  const maxAttemptsPerHour =
    config.signIn?.maxFailedAttemptsPerHour ??
    DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;

  return Fx.from({
    ok: () => authDb(ctx, config).rateLimits.get(identifier),
    err: (e) =>
      new AuthError(
        "INTERNAL_ERROR",
        `Failed to get rate limit: ${errorMessage(e)}`,
      ),
  }).pipe(
    Fx.map((raw) => {
      const limit = raw as
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
    }),
  );
};
