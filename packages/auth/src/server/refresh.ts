import { ConvexError, GenericId } from "convex/values";
import { Effect } from "effect";

import { envOptionalNumber, readConfigSync } from "./env";
import { authDb } from "./db";
import type { AuthErrorData } from "./errors";
import type { ConvexAuthConfig, Doc, MutationCtx } from "./types";
import { LOG_LEVELS, log, maybeRedact } from "./log";

export const REFRESH_TOKEN_DIVIDER = "|";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30;
/** @internal */
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000;

/** @internal */
export async function createRefreshToken(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  sessionId: GenericId<"Session">,
  parentRefreshTokenId: GenericId<"RefreshToken"> | null,
): Promise<GenericId<"RefreshToken">> {
  const expirationTime =
    Date.now() +
    (config.session?.inactiveDurationMs ??
      readConfigSync(envOptionalNumber("AUTH_SESSION_INACTIVE_DURATION_MS")) ??
      DEFAULT_SESSION_INACTIVE_DURATION_MS);

  return authDb(ctx, config).refreshTokens.create({
    sessionId,
    expirationTime,
    parentRefreshTokenId: parentRefreshTokenId ?? undefined,
  }) as Promise<GenericId<"RefreshToken">>;
}

/** @internal */
export const parseRefreshToken = (
  refreshToken: string,
): Effect.Effect<
  {
    refreshTokenId: GenericId<"RefreshToken">;
    sessionId: GenericId<"Session">;
  },
  ConvexError<AuthErrorData>
> => {
  const [refreshTokenId, sessionId] = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  const message = `Can't parse refresh token: ${maybeRedact(refreshToken)}`;
  if (refreshTokenId == null || sessionId == null) {
    return Effect.fail(
      new ConvexError({ code: "INVALID_REFRESH_TOKEN", message }),
    );
  }
  return Effect.succeed({
    refreshTokenId: refreshTokenId as GenericId<"RefreshToken">,
    sessionId: sessionId as GenericId<"Session">,
  });
};

/** @internal */
export function invalidateRefreshTokensInSubtree(
  ctx: MutationCtx,
  refreshToken: Doc<"RefreshToken">,
  config: ConvexAuthConfig,
): Effect.Effect<Doc<"RefreshToken">[]> {
  const db = authDb(ctx, config);
  return Effect.gen(function* () {
    const tokensToInvalidate = [refreshToken];
    const visited = new Set<GenericId<"RefreshToken">>([refreshToken._id]);
    let frontier: GenericId<"RefreshToken">[] = [refreshToken._id];
    while (frontier.length > 0) {
      const nextFrontier: GenericId<"RefreshToken">[] = [];
      for (const currentTokenId of frontier) {
        const children = (yield* Effect.promise(() =>
          db.refreshTokens.getChildren(refreshToken.sessionId, currentTokenId),
        )) as Doc<"RefreshToken">[];
        for (const child of children) {
          if (visited.has(child._id)) continue;
          visited.add(child._id);
          tokensToInvalidate.push(child);
          nextFrontier.push(child._id);
        }
      }
      frontier = nextFrontier;
    }
    yield* Effect.forEach(
      tokensToInvalidate,
      (token) =>
        token.firstUsedTime === undefined ||
        token.firstUsedTime > Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS
          ? Effect.promise(() =>
              db.refreshTokens.patch(token._id, {
                firstUsedTime: Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS,
              }),
            )
          : Effect.void,
      { discard: true },
    );
    return tokensToInvalidate;
  });
}

/** @internal */
export const refreshTokenIfValid = (
  ctx: MutationCtx,
  refreshTokenId: string,
  tokenSessionId: string,
  config: ConvexAuthConfig,
): Effect.Effect<
  { session: Doc<"Session">; refreshTokenDoc: Doc<"RefreshToken"> } | null
> => {
  const db = authDb(ctx, config);

  const fetchDoc = <T>(
    promise: () => Promise<T | null>,
    failMsg: string,
  ): Effect.Effect<T | null> =>
    Effect.tryPromise({
      try: promise,
      catch: () => failMsg,
    }).pipe(
      Effect.catch((message) =>
        Effect.sync(() => {
          log(LOG_LEVELS.ERROR, message);
          return null as T | null;
        }),
      ),
    );

  const validateRefreshToken = fetchDoc(
    () =>
      db.refreshTokens.getById(
        refreshTokenId as GenericId<"RefreshToken">,
      ) as Promise<Doc<"RefreshToken"> | null>,
    "Invalid refresh token format",
  ).pipe(
    Effect.flatMap((doc) =>
      doc !== null
        ? Effect.succeed(doc)
        : Effect.fail("Invalid refresh token"),
    ),
    Effect.flatMap((doc) =>
      doc.expirationTime >= Date.now()
        ? Effect.succeed(doc)
        : Effect.fail("Expired refresh token"),
    ),
    Effect.flatMap((doc) =>
      doc.sessionId === tokenSessionId
        ? Effect.succeed(doc)
        : Effect.fail("Invalid refresh token session ID"),
    ),
  );

  return validateRefreshToken.pipe(
    Effect.flatMap((refreshTokenDoc) =>
      fetchDoc(
        () =>
          db.sessions.getById(
            refreshTokenDoc.sessionId,
          ) as Promise<Doc<"Session"> | null>,
        "Invalid refresh token session format",
      ).pipe(
        Effect.flatMap((session) =>
          session !== null
            ? Effect.succeed(session)
            : Effect.fail("Invalid refresh token session"),
        ),
        Effect.flatMap((session) =>
          session.expirationTime >= Date.now()
            ? Effect.succeed(session)
            : Effect.fail("Expired refresh token session"),
        ),
        Effect.map((session) => ({ session, refreshTokenDoc })),
      ),
    ),
    Effect.catch((message) =>
      Effect.sync(() => {
        log(LOG_LEVELS.ERROR, message);
        return null;
      }),
    ),
  );
};
