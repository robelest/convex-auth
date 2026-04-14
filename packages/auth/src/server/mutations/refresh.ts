import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";
import { Data, Effect, Match } from "effect";

import type * as Provider from "../crypto";
import { authDb } from "../db";
import { log, maybeRedact } from "../log";
import {
  invalidateRefreshTokensInSubtree,
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenIfValid,
} from "../refresh";
import { generateTokensForSession } from "../sessions";
import type { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type RefreshSessionId = GenericId<"Session">;
type RefreshTokenId = GenericId<"RefreshToken">;

const asSessionId = (id: string) => id as RefreshSessionId;
const asRefreshTokenId = (id: string) => id as RefreshTokenId;

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

const softTry = <A>(
  try_: () => Promise<A>,
  reason: string,
): Effect.Effect<A, RefreshFailure> =>
  Effect.tryPromise({
    try: try_,
    catch: () => new RefreshFailure({ reason }),
  });

const softTryEffect = <A>(
  effect: Effect.Effect<A, unknown>,
  reason: string,
): Effect.Effect<A, RefreshFailure> =>
  effect.pipe(Effect.mapError(() => new RefreshFailure({ reason })));

const softCleanup = (
  effect: Effect.Effect<unknown, RefreshFailure>,
): Effect.Effect<void> =>
  effect.pipe(
    Effect.catchTag("RefreshFailure", (failure) =>
      Effect.sync(() => {
        log("DEBUG", failure.reason);
      }),
    ),
    Effect.asVoid,
  );

export function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  _getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Effect.Effect<RefreshResult> {
  const db = authDb(ctx, config);
  const { refreshToken } = args;

  return Effect.gen(function* () {
    const { refreshTokenId, sessionId: tokenSessionId } =
      yield* parseRefreshToken(refreshToken).pipe(
        Effect.mapError(
          (error) => new RefreshFailure({ reason: error.data.message }),
        ),
      );

    yield* Effect.sync(() => {
      log(
        "DEBUG",
        `refreshSessionImpl args: Token ID: ${maybeRedact(refreshTokenId)} Session ID: ${maybeRedact(tokenSessionId)}`,
      );
    });

    const validationResult = yield* refreshTokenIfValid(
      ctx,
      refreshTokenId,
      tokenSessionId,
      config,
    );

    if (validationResult === null) {
      yield* softCleanup(
        softTry(async () => {
          const session = await db.sessions.getById(
            asSessionId(tokenSessionId),
          );
          if (session !== null) {
            await db.sessions.delete(session._id);
          }
        }, "Skipping invalid session id during refresh cleanup"),
      );

      yield* softCleanup(
        softTry(
          () =>
            authDb(ctx, config).refreshTokens.deleteAll(
              asSessionId(tokenSessionId),
            ),
          "Skipping invalid token session id during refresh token cleanup",
        ),
      );

      return null;
    }

    const { session, refreshTokenDoc } = validationResult;
    const sessionId = session._id;
    const userId = session.userId;
    const tokenFirstUsed = refreshTokenDoc.firstUsedTime;
    const tokenDispatch =
      tokenFirstUsed === undefined
        ? ({ tag: "firstUse" } as const)
        : ({ tag: "reuse", tokenFirstUsed } as const);

    return yield* Match.value(tokenDispatch).pipe(
      Match.when({ tag: "firstUse" }, () =>
        softTryEffect(
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              db.refreshTokens.patch(asRefreshTokenId(refreshTokenId), {
                firstUsedTime: Date.now(),
              }),
            );
            const result = yield* Effect.promise(() =>
              generateTokensForSession(ctx, config, {
                userId,
                sessionId,
                issuedRefreshTokenId: null,
                parentRefreshTokenId: asRefreshTokenId(refreshTokenId),
              }),
            );
            const { refreshTokenId: newRefreshTokenId } =
              yield* parseRefreshToken(result.refreshToken).pipe(
                Effect.mapError(
                  (error) => new RefreshFailure({ reason: error.data.message }),
                ),
              );
            yield* Effect.sync(() => {
              log(
                "DEBUG",
                `Exchanged ${maybeRedact(refreshTokenDoc._id)} (first use) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
              );
            });
            return result;
          }),
          "Failed during first-use token exchange",
        ),
      ),
      Match.when({ tag: "reuse" }, ({ tokenFirstUsed }) =>
        softTry(
          () =>
            authDb(ctx, config).refreshTokens.getActive(
              asSessionId(tokenSessionId),
            ),
          "Failed to load active refresh token",
        ).pipe(
          Effect.flatMap((activeRefreshToken) => {
            log(
              "DEBUG",
              `Active refresh token: ${maybeRedact(activeRefreshToken?._id ?? "(none)")}, parent ${maybeRedact(activeRefreshToken?.parentRefreshTokenId ?? "(none)")}`,
            );

            const reuseDispatch =
              activeRefreshToken !== null &&
              activeRefreshToken.parentRefreshTokenId === refreshTokenId
                ? ({
                    tag: "parentOfActive",
                    activeRefreshToken,
                  } as const)
                : tokenFirstUsed + REFRESH_TOKEN_REUSE_WINDOW_MS > Date.now()
                  ? ({ tag: "withinReuseWindow" } as const)
                  : ({ tag: "outsideReuseWindow" } as const);

            return Match.value(reuseDispatch).pipe(
              Match.when({ tag: "parentOfActive" }, ({ activeRefreshToken }) =>
                softTry(
                  () =>
                    generateTokensForSession(ctx, config, {
                      userId,
                      sessionId,
                      issuedRefreshTokenId: activeRefreshToken._id,
                      parentRefreshTokenId: asRefreshTokenId(refreshTokenId),
                    }),
                  "Failed to generate tokens for parent reuse",
                ).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      log(
                        "DEBUG",
                        `Token ${maybeRedact(refreshTokenDoc._id)} is parent of active refresh token ${maybeRedact(activeRefreshToken._id)}, so returning that token`,
                      );
                    }),
                  ),
                ),
              ),
              Match.when({ tag: "withinReuseWindow" }, () =>
                softTryEffect(
                  Effect.gen(function* () {
                    const result = yield* Effect.promise(() =>
                      generateTokensForSession(ctx, config, {
                        userId,
                        sessionId,
                        issuedRefreshTokenId: null,
                        parentRefreshTokenId: asRefreshTokenId(refreshTokenId),
                      }),
                    );
                    const { refreshTokenId: newRefreshTokenId } =
                      yield* parseRefreshToken(result.refreshToken).pipe(
                        Effect.mapError(
                          (error) =>
                            new RefreshFailure({ reason: error.data.message }),
                        ),
                      );
                    yield* Effect.sync(() => {
                      log(
                        "DEBUG",
                        `Exchanged ${maybeRedact(refreshTokenDoc._id)} (reuse) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
                      );
                    });
                    return result;
                  }),
                  "Failed to generate tokens for reuse window",
                ),
              ),
              Match.when({ tag: "outsideReuseWindow" }, () =>
                softTryEffect(
                  Effect.gen(function* () {
                    yield* Effect.sync(() => {
                      log(
                        "ERROR",
                        "Refresh token used outside of reuse window",
                      );
                      log(
                        "DEBUG",
                        `Token ${maybeRedact(refreshTokenDoc._id)} being used outside of reuse window, so invalidating all refresh tokens in subtree`,
                      );
                    });
                    const tokensToInvalidate =
                      yield* invalidateRefreshTokensInSubtree(
                        ctx,
                        refreshTokenDoc,
                        config,
                      );
                    yield* Effect.sync(() => {
                      log(
                        "DEBUG",
                        `Invalidated ${tokensToInvalidate.length} refresh tokens in subtree: ${tokensToInvalidate
                          .map((token) => maybeRedact(token._id))
                          .join(", ")}`,
                      );
                    });
                    return null;
                  }),
                  "Failed to invalidate refresh tokens in subtree",
                ),
              ),
              Match.exhaustive,
            );
          }),
        ),
      ),
      Match.exhaustive,
    );
  }).pipe(
    Effect.withSpan("convex-auth.refresh.session", {
      attributes: { hasRefreshToken: true },
    }),
    Effect.catch((failure) =>
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
