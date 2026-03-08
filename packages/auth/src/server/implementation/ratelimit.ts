import { ConvexAuthConfig } from "../types";
import { authDb } from "./db";
import { Doc, MutationCtx } from "./types";

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
  return state.attemptsLeft < 1;
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
      attemptsLeft: state.attemptsLeft - 1,
      lastAttemptTime: Date.now(),
    });
  } else {
    const maxAttemptsPerHour = configuredMaxAttemptsPerHour(config);
    await db.rateLimits.create({
      identifier,
      attemptsLeft: maxAttemptsPerHour - 1,
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
  const maxAttemptsPerHour = configuredMaxAttemptsPerHour(config);
  const limit = (await authDb(ctx, config).rateLimits.get(identifier)) as
    | (Doc<"RateLimit"> & { attemptsLeft: number; lastAttemptTime: number })
    | null;
  if (limit === null) {
    return null;
  }
  const elapsed = now - limit.lastAttemptTime;
  const maxAttemptsPerMs = maxAttemptsPerHour / (60 * 60 * 1000);
  const attemptsLeft = Math.min(
    maxAttemptsPerHour,
    limit.attemptsLeft + elapsed * maxAttemptsPerMs,
  );
  return { limit, attemptsLeft };
}

function configuredMaxAttemptsPerHour(config: ConvexAuthConfig) {
  return (
    config.signIn?.max_failed_attempts_per_hour ??
    config.signIn?.maxFailedAttempsPerHour ??
    DEFAULT_MAX_SIGN_IN_ATTEMPTS_PER_HOUR
  );
}
