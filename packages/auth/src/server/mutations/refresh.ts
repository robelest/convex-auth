import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";
import { Data, Effect } from "effect";

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
import { AUTH_STORE_REF } from "./store/refs";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

type RefreshResult = null | {
  token: string;
  refreshToken: string;
};

class RefreshFailure extends Data.TaggedError("RefreshFailure")<{
  readonly reason: string;
}> {}

export function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  config: Provider.Config,
): Effect.Effect<RefreshResult> {
  const db = authDb(ctx, config);

  return Effect.gen(function* () {
    const { refreshTokenId, sessionId } = yield* parseRefreshToken(
      args.refreshToken,
    ).pipe(
      Effect.mapError(
        (error) => new RefreshFailure({ reason: error.data.message }),
      ),
    );

    yield* Effect.sync(() => {
      log(
        "DEBUG",
        `refreshSessionImpl args: Token ID: ${maybeRedact(refreshTokenId)} Session ID: ${maybeRedact(sessionId)}`,
      );
    });

    const exchanged = yield* Effect.tryPromise({
      try: () =>
        db.refreshTokens.exchange({
          refreshTokenId,
          sessionId,
          now: Date.now(),
          refreshTokenExpirationTime: refreshTokenExpirationTime(config),
          reuseWindowMs: REFRESH_TOKEN_REUSE_WINDOW_MS,
        }),
      catch: () =>
        new RefreshFailure({ reason: "Failed to exchange refresh token" }),
    });

    if (exchanged === null) {
      return null;
    }

    return yield* Effect.tryPromise({
      try: () =>
        generateTokensForSession(config, {
          userId: exchanged.userId as GenericId<"User">,
          sessionId: exchanged.sessionId as GenericId<"Session">,
          refreshTokenId: exchanged.refreshTokenId as GenericId<"RefreshToken">,
        }),
      catch: () =>
        new RefreshFailure({
          reason: "Failed to generate refresh-session tokens",
        }),
    });
  }).pipe(
    Effect.withSpan("convex-auth.refresh.session", {
      attributes: { hasRefreshToken: true },
    }),
    Effect.catchTag("RefreshFailure", (failure) =>
      Effect.sync(() => {
        log("DEBUG", failure.reason);
        return null;
      }),
    ),
  );
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
