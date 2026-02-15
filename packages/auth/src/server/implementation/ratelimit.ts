import { ConvexAuthConfig } from "../types";
import { Doc, MutationCtx } from "./types";
import { authDb } from "./db";

const DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR = 10;

export async function isSignInRateLimited(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
) {
  const state = await getRateLimitState(ctx, identifier, config);
  if (state === null) {
    return false;
  }
  return state.attempsLeft < 1;
}

export async function recordFailedSignIn(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const state = await getRateLimitState(ctx, identifier, config);
  if (state !== null) {
    await db.rateLimits.patch(state.limit._id, {
      attemptsLeft: state.attempsLeft - 1,
      lastAttemptTime: Date.now(),
    });
  } else {
    const maxAttempsPerHour = configuredMaxAttempsPerHour(config);
    await db.rateLimits.create({
      identifier,
      attemptsLeft: maxAttempsPerHour - 1,
      lastAttemptTime: Date.now(),
    });
  }
}

export async function resetSignInRateLimit(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
) {
  const existingState = await getRateLimitState(ctx, identifier, config);
  if (existingState !== null) {
    await authDb(ctx, config).rateLimits.delete(existingState.limit._id);
  }
}

async function getRateLimitState(
  ctx: MutationCtx,
  identifier: string,
  config: ConvexAuthConfig,
) {
  const now = Date.now();
  const maxAttempsPerHour = configuredMaxAttempsPerHour(config);
  const limit = (await authDb(ctx, config).rateLimits.get(identifier)) as
    | Doc<"limit">
    | null;
  if (limit === null) {
    return null;
  }
  const elapsed = now - limit.lastAttemptTime;
  const maxAttempsPerMs = maxAttempsPerHour / (60 * 60 * 1000);
  const attempsLeft = Math.min(
    maxAttempsPerHour,
    limit.attemptsLeft + elapsed * maxAttempsPerMs,
  );
  return { limit, attempsLeft };
}

function configuredMaxAttempsPerHour(config: ConvexAuthConfig) {
  return (
    config.signIn?.maxFailedAttempsPerHour ??
    DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR
  );
}
