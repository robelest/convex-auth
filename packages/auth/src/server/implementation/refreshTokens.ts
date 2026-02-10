import { GenericId } from "convex/values";
import { ConvexAuthConfig } from "../types.js";
import { Doc, MutationCtx } from "./types.js";
import {
  LOG_LEVELS,
  REFRESH_TOKEN_DIVIDER,
  logWithLevel,
  maybeRedact,
  stringToNumber,
} from "./utils.js";
import { createAuthDb } from "./db.js";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000; // 10 seconds
export async function createRefreshToken(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  sessionId: GenericId<"session">,
  parentRefreshTokenId: GenericId<"token"> | null,
) {
  const expirationTime =
    Date.now() +
    (config.session?.inactiveDurationMs ??
      stringToNumber(process.env.AUTH_SESSION_INACTIVE_DURATION_MS) ??
      DEFAULT_SESSION_INACTIVE_DURATION_MS);
  if (config.component !== undefined) {
    return (await createAuthDb(ctx, config.component).refreshTokens.create({
      sessionId,
      expirationTime,
      parentRefreshTokenId: parentRefreshTokenId ?? undefined,
    })) as GenericId<"token">;
  }
  const newRefreshTokenId = await ctx.db.insert("token", {
    sessionId,
    expirationTime,
    parentRefreshTokenId: parentRefreshTokenId ?? undefined,
  });
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
    throw new Error(`Can't parse refresh token: ${maybeRedact(refreshToken)}`);
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
  const authDb =
    config.component !== undefined ? createAuthDb(ctx, config.component) : null;
  const tokensToInvalidate = [refreshToken];
  let frontier = [refreshToken._id];
  while (frontier.length > 0) {
    const nextFrontier = [];
    for (const currentTokenId of frontier) {
      const children =
        authDb !== null
          ? ((await authDb.refreshTokens.getChildren(
              refreshToken.sessionId,
              currentTokenId,
            )) as Doc<"token">[])
          : await ctx.db
              .query("token")
              .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
                q
                  .eq("sessionId", refreshToken.sessionId)
                  .eq("parentRefreshTokenId", currentTokenId),
              )
              .collect();
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
      if (authDb !== null) {
        await authDb.refreshTokens.patch(token._id, {
          firstUsedTime: Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS,
        });
      } else {
        await ctx.db.patch(token._id, {
          firstUsedTime: Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS,
        });
      }
    }
  }
  return tokensToInvalidate;
}

export async function deleteAllRefreshTokens(
  ctx: MutationCtx,
  sessionId: GenericId<"session">,
  config: ConvexAuthConfig,
) {
  if (config.component !== undefined) {
    await createAuthDb(ctx, config.component).refreshTokens.deleteAll(sessionId);
    return;
  }
  const existingRefreshTokens = await ctx.db
    .query("token")
    .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
      q.eq("sessionId", sessionId),
    )
    .collect();
  for (const refreshTokenDoc of existingRefreshTokens) {
    await ctx.db.delete(refreshTokenDoc._id);
  }
}

export async function refreshTokenIfValid(
  ctx: MutationCtx,
  refreshTokenId: string,
  tokenSessionId: string,
  config: ConvexAuthConfig,
) {
  const authDb =
    config.component !== undefined ? createAuthDb(ctx, config.component) : null;
  let refreshTokenDoc: Doc<"token"> | null;
  try {
    refreshTokenDoc =
      authDb !== null
        ? ((await authDb.refreshTokens.getById(
            refreshTokenId as GenericId<"token">,
          )) as Doc<"token"> | null)
        : await ctx.db.get(refreshTokenId as GenericId<"token">);
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
    session =
      authDb !== null
        ? ((await authDb.sessions.getById(refreshTokenDoc.sessionId)) as
            | Doc<"session">
            | null)
        : await ctx.db.get(refreshTokenDoc.sessionId);
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
  if (config.component !== undefined) {
    return (await createAuthDb(ctx, config.component).refreshTokens.getActive(
      sessionId,
    )) as Doc<"token"> | null;
  }
  return ctx.db
    .query("token")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .filter((q) => q.eq(q.field("firstUsedTime"), undefined))
    .order("desc")
    .first();
}
