import { Auth } from "convex/server";
import { GenericId } from "convex/values";

import { authDb } from "./db";
import { envOptionalNumber, readConfigSync } from "./env";
import { LOG_LEVELS, log, maybeRedact } from "./log";
import { REFRESH_TOKEN_DIVIDER, refreshTokenExpirationTime } from "./refresh";
import { generateToken } from "./tokens";
import { TOKEN_SUB_CLAIM_DIVIDER } from "./tokens";
import { ConvexAuthConfig, Doc, MutationCtx, SessionInfo } from "./types";

const DEFAULT_SESSION_TOTAL_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const sessionExpirationTime = (
  config: ConvexAuthConfig,
  now = Date.now(),
) =>
  now +
  (config.session?.totalDurationMs ??
    readConfigSync(envOptionalNumber("AUTH_SESSION_TOTAL_DURATION_MS")) ??
    DEFAULT_SESSION_TOTAL_DURATION_MS);

const encodeRefreshToken = (
  refreshTokenId: GenericId<"RefreshToken">,
  sessionId: GenericId<"Session">,
) => `${refreshTokenId}${REFRESH_TOKEN_DIVIDER}${sessionId}`;

/** @internal */
export async function maybeGenerateTokensForSession(
  config: ConvexAuthConfig,
  args: {
    userId: GenericId<"User">;
    sessionId: GenericId<"Session">;
    refreshTokenId?: GenericId<"RefreshToken">;
  },
  generateTokens: boolean,
): Promise<SessionInfo> {
  return {
    userId: args.userId,
    sessionId: args.sessionId,
    tokens:
      generateTokens && args.refreshTokenId !== undefined
        ? await generateTokensForSession(config, {
            userId: args.userId,
            sessionId: args.sessionId,
            refreshTokenId: args.refreshTokenId,
          })
        : null,
  };
}

/** @internal */
export async function issueSession(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  args: {
    userId: GenericId<"User">;
    existingSessionId?: GenericId<"Session">;
    replaceSessionId?: GenericId<"Session">;
    generateTokens: boolean;
  },
): Promise<SessionInfo> {
  const db = authDb(ctx, config);
  const issued = await db.sessions.issue({
    userId: args.userId,
    sessionId: args.existingSessionId,
    replaceSessionId: args.replaceSessionId,
    sessionExpirationTime: sessionExpirationTime(config),
    refreshTokenExpirationTime: args.generateTokens
      ? refreshTokenExpirationTime(config)
      : undefined,
  });

  return await maybeGenerateTokensForSession(
    config,
    {
      userId: issued.userId as GenericId<"User">,
      sessionId: issued.sessionId as GenericId<"Session">,
      refreshTokenId: issued.refreshTokenId as
        | GenericId<"RefreshToken">
        | undefined,
    },
    args.generateTokens,
  );
}

/** @internal */
export async function generateTokensForSession(
  config: ConvexAuthConfig,
  args: {
    userId: GenericId<"User">;
    sessionId: GenericId<"Session">;
    refreshTokenId: GenericId<"RefreshToken">;
  },
) {
  const result = {
    token: await generateToken(
      { userId: args.userId, sessionId: args.sessionId },
      config,
    ),
    refreshToken: encodeRefreshToken(args.refreshTokenId, args.sessionId),
  };
  log(
    LOG_LEVELS.DEBUG,
    `Generated token ${maybeRedact(result.token)} and refresh token ${maybeRedact(args.refreshTokenId)} for session ${maybeRedact(args.sessionId)}`,
  );
  return result;
}

/** @internal */
export async function deleteSession(
  ctx: MutationCtx,
  session: Doc<"Session">,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  await db.sessions.delete(session._id);
  await db.refreshTokens.deleteAll(session._id);
}

/**
 * Return the current session ID from the auth identity subject.
 *
 * Internal helper used by auth runtime internals and `auth.session.current`.
 */
/** @internal */
export async function getAuthSessionId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
  return sessionId as GenericId<"Session">;
}
