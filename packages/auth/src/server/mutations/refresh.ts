import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import type * as Provider from "../crypto";
import { authDb } from "../db";
import { log, maybeRedact } from "../log";
import {
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenExpirationTime,
} from "../refresh";
import { generateTokensForSession } from "../sessions";
import type { MutationCtx } from "../types";
import { withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

type RefreshResult = null | {
  token: string;
  refreshToken: string;
};

export async function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  config: Provider.Config,
): Promise<RefreshResult> {
  const db = authDb(ctx, config);

  return withSpan(
    "convex-auth.refresh.session",
    { hasRefreshToken: true },
    async () => {
      try {
        let refreshTokenId: GenericId<"RefreshToken">;
        let sessionId: GenericId<"Session">;
        try {
          ({ refreshTokenId, sessionId } = parseRefreshToken(
            args.refreshToken,
          ));
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

        try {
          return await generateTokensForSession(config, {
            userId: exchanged.userId as GenericId<"User">,
            sessionId: exchanged.sessionId as GenericId<"Session">,
            refreshTokenId:
              exchanged.refreshTokenId as GenericId<"RefreshToken">,
          });
        } catch {
          throw new RefreshFailure("Failed to generate refresh-session tokens");
        }
      } catch (e) {
        if (e instanceof RefreshFailure) {
          log("DEBUG", e.reason);
          return null;
        }
        throw e;
      }
    },
  );
}

class RefreshFailure extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export const callRefreshSession = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof refreshSessionArgs>,
): Promise<RefreshResult> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "refreshSession",
      ...args,
    },
  }) as Promise<RefreshResult>;
};
