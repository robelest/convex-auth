import { Infer, v } from "convex/values";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Doc, MutationCtx } from "../types";
import * as Provider from "../provider";
import { logWithLevel, maybeRedact } from "../utils";
import {
  deleteAllRefreshTokens,
  invalidateRefreshTokensInSubtree,
  loadActiveRefreshToken,
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenIfValid,
} from "../refresh";
import { generateTokensForSession } from "../sessions";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

type ReturnType = null | {
  token: string;
  refreshToken: string;
};

export async function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const db = authDb(ctx, config);
  const { refreshToken } = args;
  const { refreshTokenId, sessionId: tokenSessionId } =
    parseRefreshToken(refreshToken);
  logWithLevel(
    "DEBUG",
    `refreshSessionImpl args: Token ID: ${maybeRedact(refreshTokenId)} Session ID: ${maybeRedact(
      tokenSessionId,
    )}`,
  );
  const validationResult = await refreshTokenIfValid(
    ctx,
    refreshTokenId,
    tokenSessionId,
    config,
  );

  if (validationResult === null) {
    // Replicating `deleteSession` but ensuring that we delete both the session
    // and the refresh token, even if one of them is missing.
    let session: Doc<"session"> | null = null;
    try {
      session = await db.sessions.getById(tokenSessionId);
    } catch {
      logWithLevel("DEBUG", "Skipping invalid session id during refresh cleanup");
    }
    if (session !== null) {
      await db.sessions.delete(session._id);
    }
    try {
      await deleteAllRefreshTokens(ctx, tokenSessionId, config);
    } catch {
      logWithLevel(
        "DEBUG",
        "Skipping invalid token session id during refresh token cleanup",
      );
    }
    return null;
  }
  const { session } = validationResult;
  const sessionId = session._id;
  const userId = session.userId;

  const tokenFirstUsed = validationResult.refreshTokenDoc.firstUsedTime;

  // First use -- mark as used and generate new refresh token
  if (tokenFirstUsed === undefined) {
    await db.refreshTokens.patch(refreshTokenId, {
      firstUsedTime: Date.now(),
    });
    const result = await generateTokensForSession(ctx, config, {
      userId,
      sessionId,
      issuedRefreshTokenId: null,
      parentRefreshTokenId: refreshTokenId,
    });
    const { refreshTokenId: newRefreshTokenId } = parseRefreshToken(
      result.refreshToken,
    );
    logWithLevel(
      "DEBUG",
      `Exchanged ${maybeRedact(validationResult.refreshTokenDoc._id)} (first use) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
    );
    return result;
  }

  // Token has been used before
  // Check if parent of active refresh token
  const activeRefreshToken = await loadActiveRefreshToken(
    ctx,
    tokenSessionId,
    config,
  );
  logWithLevel(
    "DEBUG",
    `Active refresh token: ${maybeRedact(activeRefreshToken?._id ?? "(none)")}, parent ${maybeRedact(activeRefreshToken?.parentRefreshTokenId ?? "(none)")}`,
  );
  if (
    activeRefreshToken !== null &&
    activeRefreshToken.parentRefreshTokenId === refreshTokenId
  ) {
    logWithLevel(
      "DEBUG",
      `Token ${maybeRedact(validationResult.refreshTokenDoc._id)} is parent of active refresh token ${maybeRedact(activeRefreshToken._id)}, so returning that token`,
    );

    const result = await generateTokensForSession(ctx, config, {
      userId,
      sessionId,
      issuedRefreshTokenId: activeRefreshToken._id,
      parentRefreshTokenId: refreshTokenId,
    });
    return result;
  }

  // Check if within reuse window
  if (tokenFirstUsed + REFRESH_TOKEN_REUSE_WINDOW_MS > Date.now()) {
    const result = await generateTokensForSession(ctx, config, {
      userId,
      sessionId,
      issuedRefreshTokenId: null,
      parentRefreshTokenId: refreshTokenId,
    });
    const { refreshTokenId: newRefreshTokenId } = parseRefreshToken(
      result.refreshToken,
    );
    logWithLevel(
      "DEBUG",
      `Exchanged ${maybeRedact(validationResult.refreshTokenDoc._id)} (reuse) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
    );
    return result;
  } else {
    // Outside of reuse window -- invalidate all refresh tokens in subtree
    logWithLevel("ERROR", "Refresh token used outside of reuse window");
    logWithLevel(
      "DEBUG",
      `Token ${maybeRedact(validationResult.refreshTokenDoc._id)} being used outside of reuse window, so invalidating all refresh tokens in subtree`,
    );
    const tokensToInvalidate = await invalidateRefreshTokensInSubtree(
      ctx,
      validationResult.refreshTokenDoc,
      config,
    );
    logWithLevel(
      "DEBUG",
      `Invalidated ${tokensToInvalidate.length} refresh tokens in subtree: ${tokensToInvalidate
        .map((token) => maybeRedact(token._id))
        .join(", ")}`,
    );
    return null;
  }
}

export const callRefreshSession = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof refreshSessionArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "refreshSession",
      ...args,
    },
  });
};
