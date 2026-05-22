import type { ConvexAuthConfig, MutationCtx } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

function maxAttempts(config: ConvexAuthConfig) {
  return config.signIn?.maxFailedAttemptsPerHour ?? DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR;
}

/**
 * Opaque token returned by {@link getSignInRateLimitState}. Kept for
 * back-compat with callers that thread state through; the underlying
 * `@convex-dev/rate-limiter` component manages its own storage.
 *
 * @internal
 */
export type SignInRateLimitState = { identifier: string; ok: boolean };

/**
 * Fetch the live rate-limit state for a sign-in identifier without
 * consuming a token.
 *
 * @internal
 */
export async function getSignInRateLimitState(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<SignInRateLimitState> {
  const result = await ctx.runQuery(config.component.limits.signInCheck, {
    identifier,
    maxAttemptsPerHour: maxAttempts(config),
  });
  return { identifier, ok: result.ok };
}

/**
 * Check whether the given identifier is currently rate-limited.
 *
 * @internal
 */
export async function isSignInRateLimited(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
): Promise<boolean> {
  const { ok } = await ctx.runQuery(config.component.limits.signInCheck, {
    identifier,
    maxAttemptsPerHour: maxAttempts(config),
  });
  return !ok;
}

/**
 * Test a previously-loaded rate-limit state without re-reading.
 *
 * @internal
 */
export function isStateRateLimited(state: SignInRateLimitState | null): boolean {
  return state !== null && !state.ok;
}

/**
 * Record a failed sign-in attempt for the given identifier.
 *
 * @internal
 */
export async function recordFailedSignIn(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
  _state?: SignInRateLimitState | null,
): Promise<void> {
  await ctx.runMutation(config.component.limits.signInRecord, {
    identifier,
    maxAttemptsPerHour: maxAttempts(config),
  });
}

/**
 * Reset the rate limit for the given identifier.
 *
 * @internal
 */
export async function resetSignInRateLimit(
  ctx: MutationCtx,
  identifier: string,
  _config: ConvexAuthConfig,
  _state?: SignInRateLimitState | null,
): Promise<void> {
  await ctx.runMutation(_config.component.limits.signInReset, { identifier });
}
