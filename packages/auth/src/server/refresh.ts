import { Fx } from "@robelest/fx";
import { GenericId } from "convex/values";

import { authDb } from "./db";
import { AuthError } from "./authError";
import { Doc, MutationCtx } from "./types";
import { ConvexAuthConfig } from "./types";
import {
  LOG_LEVELS,
  REFRESH_TOKEN_DIVIDER,
  logWithLevel,
  maybeRedact,
} from "./utils";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
/** @internal */
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000; // 10 seconds

// ---------------------------------------------------------------------------
// Refresh token CRUD
// ---------------------------------------------------------------------------

/**
 * Create a new refresh token for the given session.
 */
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
      (process.env.AUTH_SESSION_INACTIVE_DURATION_MS !== undefined
        ? Number(process.env.AUTH_SESSION_INACTIVE_DURATION_MS)
        : undefined) ??
      DEFAULT_SESSION_INACTIVE_DURATION_MS);

  return authDb(ctx, config).refreshTokens.create({
    sessionId,
    expirationTime,
    parentRefreshTokenId: parentRefreshTokenId ?? undefined,
  }) as Promise<GenericId<"RefreshToken">>;
}

/**
 * Parse a compound refresh token string into its constituent IDs.
 */
/** @internal */
export const parseRefreshToken = (
  refreshToken: string,
): Fx<
  {
    refreshTokenId: GenericId<"RefreshToken">;
    sessionId: GenericId<"Session">;
  },
  AuthError
> => {
  const [refreshTokenId, sessionId] = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  const msg = `Can't parse refresh token: ${maybeRedact(refreshToken)}`;
  const refreshTokenIdFx: Fx<string, AuthError> =
    refreshTokenId != null
      ? Fx.succeed(refreshTokenId)
      : Fx.fail(new AuthError("INVALID_REFRESH_TOKEN", msg));

  return refreshTokenIdFx.pipe(
    Fx.chain((rtId) => {
      const sessionIdFx: Fx<string, AuthError> =
        sessionId != null
          ? Fx.succeed(sessionId)
          : Fx.fail(new AuthError("INVALID_REFRESH_TOKEN", msg));
      return sessionIdFx.pipe(
        Fx.map((sId) => ({
          refreshTokenId: rtId as GenericId<"RefreshToken">,
          sessionId: sId as GenericId<"Session">,
        })),
      );
    }),
  );
};

/**
 * Mark all refresh tokens descending from the given refresh token as invalid
 * immediately. Used when we detect token reuse — revoke the entire tree.
 */
/** @internal */
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
        if (visited.has(child._id)) continue;
        visited.add(child._id);
        tokensToInvalidate.push(child);
        nextFrontier.push(child._id);
      }
    }
    frontier = nextFrontier;
  }
  await Fx.run(
    Fx.each(tokensToInvalidate, (token) =>
      token.firstUsedTime === undefined ||
      token.firstUsedTime > Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS
        ? Fx.from({
            ok: () =>
              db.refreshTokens.patch(token._id, {
                firstUsedTime: Date.now() - REFRESH_TOKEN_REUSE_WINDOW_MS,
              }),
            err: (e) => e as never,
          })
        : Fx.unit,
    ),
  );
  return tokensToInvalidate;
}

// ---------------------------------------------------------------------------
// Validation pipeline — the core of refresh token handling
// ---------------------------------------------------------------------------

/**
 * Validate a refresh token and its associated session.
 *
 * Returns `null` on any validation failure (matching original semantics).
 * Each validation step is a small composable function chained with `Fx.chain`.
 * On failure, the error message is logged and the pipeline folds to `null`.
 */
/** @internal */
export const refreshTokenIfValid = (
  ctx: MutationCtx,
  refreshTokenId: string,
  tokenSessionId: string,
  config: ConvexAuthConfig,
): Fx<
  { session: Doc<"Session">; refreshTokenDoc: Doc<"RefreshToken"> } | null,
  never
> => {
  const db = authDb(ctx, config);

  const fetchDoc = <T>(
    promise: () => Promise<T | null>,
    failMsg: string,
  ): Fx<T | null, never> =>
    Fx.from({ ok: promise, err: () => failMsg }).pipe(
      Fx.recover((msg) => {
        logWithLevel(LOG_LEVELS.ERROR, msg);
        return Fx.succeed(null as T | null);
      }),
    );

  // The entire validation is a single pipeline:
  // fetch token → not null → not expired → session matches → fetch session → not null → not expired → combine
  return fetchDoc(
    () =>
      db.refreshTokens.getById(
        refreshTokenId as GenericId<"RefreshToken">,
      ) as Promise<Doc<"RefreshToken"> | null>,
    "Invalid refresh token format",
  )
    .pipe(
      Fx.chain((doc) =>
        doc !== null ? Fx.succeed(doc) : Fx.fail("Invalid refresh token"),
      ),
      Fx.chain((doc) =>
        doc.expirationTime >= Date.now()
          ? Fx.succeed(doc)
          : Fx.fail("Expired refresh token"),
      ),
      Fx.chain((doc) =>
        doc.sessionId === tokenSessionId
          ? Fx.succeed(doc)
          : Fx.fail("Invalid refresh token session ID"),
      ),
    )
    .pipe(
      Fx.chain((doc: Doc<"RefreshToken">) =>
        fetchDoc(
          () =>
            db.sessions.getById(
              doc.sessionId,
            ) as Promise<Doc<"Session"> | null>,
          "Invalid refresh token session format",
        ).pipe(
          Fx.chain((session) =>
            session !== null
              ? Fx.succeed(session)
              : Fx.fail("Invalid refresh token session"),
          ),
          Fx.chain((session) =>
            session.expirationTime >= Date.now()
              ? Fx.succeed(session)
              : Fx.fail("Expired refresh token session"),
          ),
          Fx.map((session) => ({
            session,
            refreshTokenDoc: doc,
          })),
        ),
      ),
      Fx.fold({
        ok: (result) => result,
        err: (msg) => {
          logWithLevel(LOG_LEVELS.ERROR, msg);
          return null;
        },
      }),
    );
};
