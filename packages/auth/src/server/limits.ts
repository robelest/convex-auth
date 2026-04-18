import { authDb } from "./db";
import type { ConvexAuthConfig, Doc, MutationCtx } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Resolved rate-limit state for a sign-in identifier, along with the raw
 * document so callers can patch/delete by id without a second lookup.
 *
 * @internal
 */
export type SignInRateLimitState = {
  limit: Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number };
  attemptsLeft: number;
};

/**
 * Fetch and compute the live rate-limit state for a sign-in identifier.
 *
 * Returns `null` when no rate-limit document exists yet (the identifier
 * has never seen a failed attempt). The returned `limit` document carries
 * the `_id` needed for any subsequent `patch`/`delete` — letting the
 * caller reuse the same fetch instead of refetching inside each mutator.
 *
 * @internal
 */
export async function getSignInRateLimitState(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<SignInRateLimitState | null> {
  return await getRateLimitState(ctx, identifier, config);
}

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
  return isStateRateLimited(state);
}

/**
 * Test a previously-loaded rate-limit state without re-reading the doc.
 * @internal
 */
export function isStateRateLimited(state: SignInRateLimitState | null): boolean {
  return state !== null && state.attemptsLeft < 1;
}

/**
 * Record a failed sign-in attempt for the given identifier.
 *
 * Accepts an optional pre-loaded `state` so callers that already fetched
 * the rate-limit doc (typically via {@link getSignInRateLimitState}) can
 * avoid a second component round-trip.
 *
 * @internal
 */
export async function recordFailedSignIn(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
  state?: SignInRateLimitState | null,
): Promise<void> {
  const resolved = state !== undefined ? state : await getRateLimitState(ctx, identifier, config);
  if (resolved !== null) {
    await authDb(ctx, config).rateLimits.patch(resolved.limit._id, {
      attemptsLeft: resolved.attemptsLeft - 1,
      lastAttemptTime: Date.now(),
    });
  } else {
    await authDb(ctx, config).rateLimits.create({
      identifier,
      attemptsLeft:
        (config.signIn?.maxFailedAttemptsPerHour ?? DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR) - 1,
      lastAttemptTime: Date.now(),
    });
  }
}

/**
 * Reset the rate limit for the given identifier.
 *
 * Accepts an optional pre-loaded `state` so callers with a cached state
 * (e.g. from an earlier {@link isSignInRateLimited} / {@link getSignInRateLimitState}
 * call) can skip the redundant read. Previously, the verify flow was loading
 * the same rate-limit doc twice per successful sign-in.
 *
 * @internal
 */
export async function resetSignInRateLimit(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
  state?: SignInRateLimitState | null,
): Promise<void> {
  const resolved = state !== undefined ? state : await getRateLimitState(ctx, identifier, config);
  if (resolved !== null) {
    await authDb(ctx, config).rateLimits.delete(resolved.limit._id);
  }
}

async function getRateLimitState(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<SignInRateLimitState | null> {
  const limit = await authDb(ctx, config).rateLimits.get(identifier);
  const typedLimit = limit as
    | (Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number })
    | null;
  if (typedLimit === null) {
    return null;
  }
  const now = Date.now();
  const maxAttemptsPerHour =
    config.signIn?.maxFailedAttemptsPerHour ?? DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;
  const elapsed = now - typedLimit.lastAttemptTime;
  const maxAttemptsPerMs = maxAttemptsPerHour / (60 * 60 * 1000);
  const attemptsLeft = Math.min(
    maxAttemptsPerHour,
    typedLimit.attemptsLeft + elapsed * maxAttemptsPerMs,
  );
  return { limit: typedLimit, attemptsLeft };
}
