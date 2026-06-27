import type { FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server";

import type { ConvexAuthConfig } from "./types";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

/**
 * Minimal context the rate-limit helpers depend on. The component API is
 * threaded in via the explicit `config` argument, so only `runQuery` /
 * `runMutation` are required. Typed with the narrowest call shape the helpers
 * actually use so both mutation handlers (credentials sign-in) and action
 * handlers (the TOTP ceremony) satisfy it, despite their differing
 * `runQuery`/`runMutation` option overloads.
 *
 * @internal
 */
export type SignInLimitCtx = {
  runQuery: <Query extends FunctionReference<"query", "public" | "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => Promise<FunctionReturnType<Query>>;
  runMutation: <Mutation extends FunctionReference<"mutation", "public" | "internal">>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>;
};

/**
 * Minimal config shape the rate-limit helpers depend on. Both
 * {@link ConvexAuthConfig} and `ConvexAuthMaterializedConfig` satisfy it, so
 * the helpers work from mutation and action handlers alike.
 *
 * @internal
 */
export type SignInLimitConfig = Pick<ConvexAuthConfig, "component" | "signIn">;

function maxAttempts(config: SignInLimitConfig) {
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
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
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
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
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
  ctx: SignInLimitCtx,
  identifier: string,
  config: SignInLimitConfig,
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
  ctx: SignInLimitCtx,
  identifier: string,
  _config: SignInLimitConfig,
  _state?: SignInRateLimitState | null,
): Promise<void> {
  await ctx.runMutation(_config.component.limits.signInReset, { identifier });
}
