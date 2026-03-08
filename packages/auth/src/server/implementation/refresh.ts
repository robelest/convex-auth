import { GenericId } from "convex/values";

import { throwAuthError } from "../errors";
import { ConvexAuthConfig } from "../types";
import { authDb } from "./db";
import { Doc, MutationCtx } from "./types";
import {
  LOG_LEVELS,
  REFRESH_TOKEN_DIVIDER,
  logWithLevel,
  maybeRedact,
  stringToNumber,
} from "./utils";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000; // 10 seconds
export async function createRefreshToken(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  sessionId: GenericId<"Session">,
  parentRefreshTokenId: GenericId<"RefreshToken"> | null,
): Promise<GenericId<"RefreshToken">> {
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
  })) as GenericId<"RefreshToken">;
  return newRefreshTokenId;
}

export const formatRefreshToken = (
  refreshTokenId: GenericId<"RefreshToken">,
  sessionId: GenericId<"Session">,
) => {
  return `${refreshTokenId}${REFRESH_TOKEN_DIVIDER}${sessionId}`;
};

export const parseRefreshToken = (
  refreshToken: string,
): {
  refreshTokenId: GenericId<"RefreshToken">;
  sessionId: GenericId<"Session">;
} => {
  const [refreshTokenId, sessionId] = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  if (!refreshTokenId || !sessionId) {
    throwAuthError(
      "INVALID_REFRESH_TOKEN",
      `Can't parse refresh token: ${maybeRedact(refreshToken)}`,
    );
  }
  return {
    refreshTokenId: refreshTokenId as GenericId<"RefreshToken">,
    sessionId: sessionId as GenericId<"Session">,
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
  refreshToken: Doc<"RefreshToken">,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const tokensToInvalidate = [refreshToken];
  const visited = new Set<GenericId<"RefreshToken">>([refreshToken._id]);
  let frontier: GenericId<"RefreshToken">[] = [refreshToken._id];
  while (frontier.length > 0) {
    const nextFrontier: GenericId<"RefreshToken">[] = [];
    for (const currentTokenId of frontier) {
      const children = (await db.refreshTokens.getChildren(
        refreshToken.sessionId,
        currentTokenId,
      )) as Doc<"RefreshToken">[];
      for (const child of children) {
        if (visited.has(child._id)) {
          continue;
        }
        visited.add(child._id);
        tokensToInvalidate.push(child);
        nextFrontier.push(child._id);
      }
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
  sessionId: GenericId<"Session">,
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
  let refreshTokenDoc: Doc<"RefreshToken"> | null;
  try {
    refreshTokenDoc = (await db.refreshTokens.getById(
      refreshTokenId as GenericId<"RefreshToken">,
    )) as Doc<"RefreshToken"> | null;
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
  let session: Doc<"Session"> | null;
  try {
    session = (await db.sessions.getById(
      refreshTokenDoc.sessionId,
    )) as Doc<"Session"> | null;
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
  sessionId: GenericId<"Session">,
  config: ConvexAuthConfig,
) {
  return (await authDb(ctx, config).refreshTokens.getActive(
    sessionId,
  )) as Doc<"RefreshToken"> | null;
}
