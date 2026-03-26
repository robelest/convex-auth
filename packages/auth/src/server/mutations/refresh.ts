import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../authError";
import * as Provider from "../crypto";
import {
  invalidateRefreshTokensInSubtree,
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenIfValid,
} from "../refresh";
import { generateTokensForSession } from "../sessions";
import { MutationCtx } from "../types";
import { logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store/refs";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

type RefreshResult = null | {
  token: string;
  refreshToken: string;
};

// ============================================================================
// Small helpers for the refresh pipeline
// ============================================================================

/** A soft refresh failure — logged and collapsed to null at the boundary. */
class RefreshFailure {
  readonly _tag = "RefreshFailure" as const;
  constructor(readonly reason: string) {}
}

// ============================================================================
// Main exported function
// ============================================================================

export async function refreshSessionImpl(
  ctx: MutationCtx,
  args: Infer<typeof refreshSessionArgs>,
  _getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<RefreshResult> {
  const db = authDb(ctx, config);
  const { refreshToken } = args;

  return Fx.run(
    parseRefreshToken(refreshToken).pipe(
      Fx.recover((err: AuthError) => Fx.fail(new RefreshFailure(err.message))),
      Fx.tap(({ refreshTokenId, sessionId: tokenSessionId }) =>
        Fx.sync(() =>
          logWithLevel(
            "DEBUG",
            `refreshSessionImpl args: Token ID: ${maybeRedact(refreshTokenId)} Session ID: ${maybeRedact(tokenSessionId)}`,
          ),
        ),
      ),
      Fx.chain(({ refreshTokenId, sessionId: tokenSessionId }) =>
        refreshTokenIfValid(ctx, refreshTokenId, tokenSessionId, config).pipe(
          Fx.chain((validationResult) =>
            validationResult === null
              ? Fx.gen(function* () {
                  yield* Fx.from({
                    ok: async () => {
                      const session = await (db as any).sessions.getById(
                        tokenSessionId,
                      );
                      if (session !== null) {
                        await (db as any).sessions.delete(session._id);
                      }
                    },
                    err: () =>
                      new RefreshFailure(
                        "Skipping invalid session id during refresh cleanup",
                      ),
                  }).pipe(
                    Fx.recover((f) => {
                      logWithLevel("DEBUG", f.reason);
                      return Fx.succeed(undefined as void);
                    }),
                  );

                  yield* Fx.from({
                    ok: () =>
                      authDb(ctx, config).refreshTokens.deleteAll(
                        tokenSessionId as any,
                      ),
                    err: () =>
                      new RefreshFailure(
                        "Skipping invalid token session id during refresh token cleanup",
                      ),
                  }).pipe(
                    Fx.recover((f) => {
                      logWithLevel("DEBUG", f.reason);
                      return Fx.succeed(undefined as void);
                    }),
                  );

                  return null;
                })
              : (() => {
                  const { session } = validationResult;
                  const sessionId = session._id;
                  const userId = session.userId;
                  const tokenFirstUsed =
                    validationResult.refreshTokenDoc.firstUsedTime;
                  return tokenFirstUsed === undefined
                    ? Fx.from({
                        ok: async () => {
                          await (db as any).refreshTokens.patch(
                            refreshTokenId,
                            {
                              firstUsedTime: Date.now(),
                            },
                          );
                          const result = await generateTokensForSession(
                            ctx,
                            config,
                            {
                              userId,
                              sessionId,
                              issuedRefreshTokenId: null,
                              parentRefreshTokenId: refreshTokenId as any,
                            },
                          );
                          const { refreshTokenId: newRefreshTokenId } =
                            await Fx.run(
                              parseRefreshToken(result.refreshToken),
                            );
                          logWithLevel(
                            "DEBUG",
                            `Exchanged ${maybeRedact(validationResult.refreshTokenDoc._id)} (first use) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
                          );
                          return result;
                        },
                        err: () =>
                          new RefreshFailure(
                            "Failed during first-use token exchange",
                          ),
                      })
                    : Fx.from({
                        ok: () =>
                          authDb(ctx, config).refreshTokens.getActive(
                            tokenSessionId as any,
                          ),
                        err: () =>
                          new RefreshFailure(
                            "Failed to load active refresh token",
                          ),
                      }).pipe(
                        Fx.chain((activeRefreshToken) => {
                          logWithLevel(
                            "DEBUG",
                            `Active refresh token: ${maybeRedact(activeRefreshToken?._id ?? "(none)")}, parent ${maybeRedact(activeRefreshToken?.parentRefreshTokenId ?? "(none)")}`,
                          );

                          const reuseDispatch =
                            activeRefreshToken !== null &&
                            activeRefreshToken.parentRefreshTokenId ===
                              refreshTokenId
                              ? ({
                                  tag: "parentOfActive",
                                  activeRefreshToken,
                                } as const)
                              : tokenFirstUsed + REFRESH_TOKEN_REUSE_WINDOW_MS >
                                  Date.now()
                                ? ({ tag: "withinReuseWindow" } as const)
                                : ({ tag: "outsideReuseWindow" } as const);

                          if (reuseDispatch.tag === "parentOfActive") {
                            return Fx.from({
                              ok: () =>
                                generateTokensForSession(ctx, config, {
                                  userId,
                                  sessionId,
                                  issuedRefreshTokenId:
                                    reuseDispatch.activeRefreshToken._id,
                                  parentRefreshTokenId: refreshTokenId as any,
                                }),
                              err: () =>
                                new RefreshFailure(
                                  "Failed to generate tokens for parent reuse",
                                ),
                            }).pipe(
                              Fx.tap(() =>
                                Fx.sync(() =>
                                  logWithLevel(
                                    "DEBUG",
                                    `Token ${maybeRedact(validationResult.refreshTokenDoc._id)} is parent of active refresh token ${maybeRedact(reuseDispatch.activeRefreshToken._id)}, so returning that token`,
                                  ),
                                ),
                              ),
                            );
                          }

                          if (reuseDispatch.tag === "withinReuseWindow") {
                            return Fx.from({
                              ok: async () => {
                                const result = await generateTokensForSession(
                                  ctx,
                                  config,
                                  {
                                    userId,
                                    sessionId,
                                    issuedRefreshTokenId: null,
                                    parentRefreshTokenId: refreshTokenId as any,
                                  },
                                );
                                const { refreshTokenId: newRefreshTokenId } =
                                  await Fx.run(
                                    parseRefreshToken(result.refreshToken),
                                  );
                                logWithLevel(
                                  "DEBUG",
                                  `Exchanged ${maybeRedact(validationResult.refreshTokenDoc._id)} (reuse) for new refresh token ${maybeRedact(newRefreshTokenId)}`,
                                );
                                return result;
                              },
                              err: () =>
                                new RefreshFailure(
                                  "Failed to generate tokens for reuse window",
                                ),
                            });
                          }

                          logWithLevel(
                            "ERROR",
                            "Refresh token used outside of reuse window",
                          );
                          logWithLevel(
                            "DEBUG",
                            `Token ${maybeRedact(validationResult.refreshTokenDoc._id)} being used outside of reuse window, so invalidating all refresh tokens in subtree`,
                          );
                          return Fx.from({
                            ok: async () => {
                              const tokensToInvalidate =
                                await invalidateRefreshTokensInSubtree(
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
                            },
                            err: () =>
                              new RefreshFailure(
                                "Failed to invalidate refresh tokens in subtree",
                              ),
                          });
                        }),
                      );
                })(),
          ),
        ),
      ),
      Fx.fold({
        ok: (result) => result,
        err: (failure) => {
          logWithLevel("DEBUG", failure.reason);
          return null;
        },
      }),
    ),
  );
}

// ============================================================================
// Invalid token path — cleanup session and refresh tokens
// ============================================================================

// ============================================================================
// Valid token path — dispatch on first-use / parent / reuse-window / stale
// ============================================================================

// ============================================================================
// Action-level caller (unchanged — just forwards to mutation)
// ============================================================================

export const callRefreshSession = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof refreshSessionArgs>,
): Promise<RefreshResult> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "refreshSession",
      ...args,
    },
  });
};
