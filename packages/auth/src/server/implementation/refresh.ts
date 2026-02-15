import { GenericId } from "convex/values";
import { ConvexAuthConfig } from "../types";
import { throwAuthError } from "../errors";
import { Doc, MutationCtx } from "./types";
import {
  LOG_LEVELS,
  REFRESH_TOKEN_DIVIDER,
  logWithLevel,
  maybeRedact,
  stringToNumber,
} from "./utils";
import { authDb } from "./db";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000; // 10 seconds
export async function createRefreshToken(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  sessionId: GenericId<"session">,
  parentRefreshTokenId: GenericId<"token"> | null,
): Promise<GenericId<"token">> {
  const db = authDb(ctx, config);
  const expirationTime =
    Date.now() +
    (config.session?.inactiveDurationMs ??
      stringToNumber(process.env.AUTH_SESSION_INACTIVE_DURATION_MS) ??
      DEFAULT_SESSION_INACTIVE_DURATION_MS);
  const newRefreshTokenId = (await db.refreshTokens.create({
    sessionId,
    expirationTime,
    parentRefreshTokenId: parentRefreshTokenId ?? undefined,
  })) as GenericId<"token">;
  return newRefreshTokenId;
}

export const formatRefreshToken = (
  refreshTokenId: GenericId<"token">,
  sessionId: GenericId<"session">,
) => {
  return `${refreshTokenId}${REFRESH_TOKEN_DIVIDER}${sessionId}`;
};

export const parseRefreshToken = (
  refreshToken: string,
): {
  refreshTokenId: GenericId<"token">;
  sessionId: GenericId<"session">;
} => {
  const [refreshTokenId, sessionId] = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  if (!refreshTokenId || !sessionId) {
    throwAuthError("INVALID_REFRESH_TOKEN", `Can't parse refresh token: ${maybeRedact(refreshToken)}`);
  }
  return {
    refreshTokenId: refreshTokenId as GenericId<"token">,
    sessionId: sessionId as GenericId<"session">,
  };
};

/**
 * Mark all refresh tokens descending from the given refresh token as invalid immediately.
 * This is used when we detect an invalid use of a refresh token, and want to revoke
 * the entire tree.
 *
 * @param ctx
 * @param refreshToken
 */
export async function invalidateRefreshTokensInSubtree(
  ctx: MutationCtx,
  refreshToken: Doc<"token">,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const tokensToInvalidate = [refreshToken];
  let frontier: GenericId<"token">[] = [refreshToken._id];
  while (frontier.length > 0) {
    const nextFrontier: GenericId<"token">[] = [];
    for (const currentTokenId of frontier) {
      const children = (await db.refreshTokens.getChildren(
        refreshToken.sessionId,
        currentTokenId,
      )) as Doc<"token">[];
      tokensToInvalidate.push(...children);
      nextFrontier.push(...children.map((child) => child._id));
    }
    frontier = nextFrontier;
  }
  for (const token of tokensToInvalidate) {
    // Mark these as used so they can't be used again (even within the reuse window)
    if (
      token.firstUsedTime === undefined ||
      token.firstUsedTime > Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS
    ) {
      await db.refreshTokens.patch(token._id, {
        firstUsedTime: Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS,
      });
    }
  }
  return tokensToInvalidate;
}

export async function deleteAllRefreshTokens(
  ctx: MutationCtx,
  sessionId: GenericId<"session">,
  config: ConvexAuthConfig,
) {
  await authDb(ctx, config).refreshTokens.deleteAll(sessionId);
}

export async function refreshTokenIfValid(
  ctx: MutationCtx,
  refreshTokenId: string,
  tokenSessionId: string,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  let refreshTokenDoc: Doc<"token"> | null;
  try {
    refreshTokenDoc = (await db.refreshTokens.getById(
      refreshTokenId as GenericId<"token">,
    )) as Doc<"token"> | null;
  } catch {
    logWithLevel(LOG_LEVELS.ERROR, "Invalid refresh token format");
    return null;
  }

  if (refreshTokenDoc === null) {
    logWithLevel(LOG_LEVELS.ERROR, "Invalid refresh token");
    return null;
  }
  if (refreshTokenDoc.expirationTime < Date.now()) {
    logWithLevel(LOG_LEVELS.ERROR, "Expired refresh token");
    return null;
  }
  if (refreshTokenDoc.sessionId !== tokenSessionId) {
    logWithLevel(LOG_LEVELS.ERROR, "Invalid refresh token session ID");
    return null;
  }
  let session: Doc<"session"> | null;
  try {
    session = (await db.sessions.getById(refreshTokenDoc.sessionId)) as
      | Doc<"session">
      | null;
  } catch {
    logWithLevel(LOG_LEVELS.ERROR, "Invalid refresh token session format");
    return null;
  }
  if (session === null) {
    logWithLevel(LOG_LEVELS.ERROR, "Invalid refresh token session");
    return null;
  }
  if (session.expirationTime < Date.now()) {
    logWithLevel(LOG_LEVELS.ERROR, "Expired refresh token session");
    return null;
  }
  return { session, refreshTokenDoc };
}
/**
 * The active refresh token is the most recently created refresh token that has
 * never been used.
 *
 * @param ctx
 * @param sessionId
 */
export async function loadActiveRefreshToken(
  ctx: MutationCtx,
  sessionId: GenericId<"session">,
  config: ConvexAuthConfig,
) {
  return (await authDb(ctx, config).refreshTokens.getActive(sessionId)) as
    | Doc<"token">
    | null;
}
