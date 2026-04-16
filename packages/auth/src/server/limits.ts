import { authDb } from "./db";
import type { ConvexAuthConfig, Doc, MutationCtx } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Check whether the given identifier is currently rate-limited.
 * @internal
 */
export async function isSignInRateLimited(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<boolean> {
  const state = await getRateLimitState(ctx, identifier, config);
  return state !== null && state.attemptsLeft < 1;
}

/**
 * Record a failed sign-in attempt for the given identifier.
 * @internal
 */
export async function recordFailedSignIn(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<void> {
  const state = await getRateLimitState(ctx, identifier, config);
  if (state !== null) {
    await authDb(ctx, config).rateLimits.patch(state.limit._id, {
      attemptsLeft: state.attemptsLeft - 1,
      lastAttemptTime: Date.now(),
    });
  } else {
    await authDb(ctx, config).rateLimits.create({
      identifier,
      attemptsLeft:
        (config.signIn?.maxFailedAttemptsPerHour ??
          DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR) - 1,
      lastAttemptTime: Date.now(),
    });
  }
}

/**
 * Reset the rate limit for the given identifier.
 * @internal
 */
export async function resetSignInRateLimit(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<void> {
  const state = await getRateLimitState(ctx, identifier, config);
  if (state !== null) {
    await authDb(ctx, config).rateLimits.delete(state.limit._id);
  }
}

type RateLimitState = {
  limit: Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number };
  attemptsLeft: number;
} | null;

async function getRateLimitState(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<RateLimitState> {
  const limit = await authDb(ctx, config).rateLimits.get(identifier);
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
}
