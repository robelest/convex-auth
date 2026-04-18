import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import type * as Provider from "../crypto";
import { authDb } from "../db";
import { log, maybeRedact } from "../log";
import {
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenExpirationTime,
} from "../refresh";
import { finalizeSessionIssuance } from "../sessions";
import type { SessionIssuance } from "../sessions";
import { REFRESH_TOKEN_DIVIDER } from "../refresh";
import { GenericActionCtxWithAuthConfig, type MutationCtx, type SessionInfo } from "../types";
import { withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

type RefreshResult = null | {
  token: string;
  refreshToken: string;
};

/**
 * Exchange a refresh token and mint the next pair of session IDs + refresh
 * token string. The RSA-2048 JWT signing used to live here; it has been
 * moved to the action wrapper ({@link callRefreshSession}) so the mutation
 * can commit without paying 5–30ms of CPU per refresh.
 *
 * @internal
 */
export async function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  config: Provider.Config,
): Promise<SessionIssuance | null> {
  const db = authDb(ctx, config);

  return withSpan("convex-auth.refresh.session", { hasRefreshToken: true }, async () => {
    try {
      let refreshTokenId: GenericId<"RefreshToken">;
      let sessionId: GenericId<"Session">;
      try {
        ({ refreshTokenId, sessionId } = parseRefreshToken(args.refreshToken));
      } catch {
        throw new RefreshFailure("Failed to parse refresh token");
      }

      log(
        "DEBUG",
        `refreshSessionImpl args: Token ID: ${maybeRedact(refreshTokenId)} Session ID: ${maybeRedact(sessionId)}`,
      );

      let exchanged;
      try {
        exchanged = await db.refreshTokens.exchange({
          refreshTokenId,
          sessionId,
          now: Date.now(),
          refreshTokenExpirationTime: refreshTokenExpirationTime(config),
          reuseWindowMs: REFRESH_TOKEN_REUSE_WINDOW_MS,
        });
      } catch {
        throw new RefreshFailure("Failed to exchange refresh token");
      }

      if (exchanged === null) {
        return null;
      }

      return {
        userId: exchanged.userId as GenericId<"User">,
        sessionId: exchanged.sessionId as GenericId<"Session">,
        refreshToken: `${exchanged.refreshTokenId as string}${REFRESH_TOKEN_DIVIDER}${exchanged.sessionId as string}`,
      } satisfies SessionIssuance;
    } catch (e) {
      if (e instanceof RefreshFailure) {
        log("DEBUG", e.reason);
        return null;
      }
      throw e;
    }
  });
}

class RefreshFailure extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

/**
 * Action-side wrapper: exchange the refresh token via the mutation, then
 * sign the next JWT outside the mutation transaction. See
 * {@link refreshSessionImpl} for the rationale.
 *
 * @internal
 */
export const callRefreshSession = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof refreshSessionArgs>,
): Promise<RefreshResult> => {
  const issuance = (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "refreshSession",
      ...args,
    },
  })) as SessionIssuance | null;
  if (issuance === null || issuance.refreshToken === null) {
    return null;
  }
  const finalized: SessionInfo = await finalizeSessionIssuance(ctx.auth.config, issuance);
  return finalized.tokens;
};
