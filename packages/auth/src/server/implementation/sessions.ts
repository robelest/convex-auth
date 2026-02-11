import { GenericId } from "convex/values";
import { ConvexAuthConfig } from "../types.js";
import { Doc, MutationCtx, SessionInfo } from "./types.js";
import { Auth } from "convex/server";
import {
  LOG_LEVELS,
  TOKEN_SUB_CLAIM_DIVIDER,
  logWithLevel,
  maybeRedact,
  stringToNumber,
} from "./utils.js";
import { generateToken } from "./tokens.js";
import {
  createRefreshToken,
  formatRefreshToken,
  deleteAllRefreshTokens,
} from "./refreshTokens.js";
import { authDb } from "./db.js";

const DEFAULT_SESSION_TOTAL_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function maybeGenerateTokensForSession(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  userId: GenericId<"user">,
  sessionId: GenericId<"session">,
  generateTokens: boolean,
): Promise<SessionInfo> {
  return {
    userId,
    sessionId,
    tokens: generateTokens
      ? await generateTokensForSession(ctx, config, {
          userId,
          sessionId,
          issuedRefreshTokenId: null,
          parentRefreshTokenId: null,
        })
      : null,
  };
}

export async function createNewAndDeleteExistingSession(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  userId: GenericId<"user">,
) {
  const db = authDb(ctx, config);
  const existingSessionId = await getAuthSessionId(ctx);
  if (existingSessionId !== null) {
    const existingSession = await db.sessions.getById(existingSessionId);
    if (existingSession !== null) {
      await deleteSession(ctx, existingSession, config);
    }
  }
  return await createSession(ctx, userId, config);
}

export async function generateTokensForSession(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  args: {
    userId: GenericId<"user">;
    sessionId: GenericId<"session">;
    issuedRefreshTokenId: GenericId<"token"> | null;
    parentRefreshTokenId: GenericId<"token"> | null;
  },
) {
  const ids = { userId: args.userId, sessionId: args.sessionId };
  const refreshTokenId =
    args.issuedRefreshTokenId ??
    (await createRefreshToken(
      ctx,
      config,
      args.sessionId,
      args.parentRefreshTokenId,
    ));
  const result = {
    token: await generateToken(ids, config),
    refreshToken: formatRefreshToken(refreshTokenId, args.sessionId),
  };
  logWithLevel(
    LOG_LEVELS.DEBUG,
    `Generated token ${maybeRedact(result.token)} and refresh token ${maybeRedact(refreshTokenId)} for session ${maybeRedact(args.sessionId)}`,
  );
  return result;
}

async function createSession(
  ctx: MutationCtx,
  userId: GenericId<"user">,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const expirationTime =
    Date.now() +
    (config.session?.totalDurationMs ??
      stringToNumber(process.env.AUTH_SESSION_TOTAL_DURATION_MS) ??
      DEFAULT_SESSION_TOTAL_DURATION_MS);
  return (await db.sessions.create(userId, expirationTime)) as GenericId<"session">;
}

export async function deleteSession(
  ctx: MutationCtx,
  session: Doc<"session">,
  config: ConvexAuthConfig,
) {
  await authDb(ctx, config).sessions.delete(session._id);
  await deleteAllRefreshTokens(ctx, session._id, config);
}

/**
 * Return the current session ID.
 *
 * ```ts filename="convex/myFunctions.tsx"
 * import { mutation } from "./_generated/server";
 * import { getAuthSessionId } from "@robelest/convex-auth/component";
 *
 * export const doSomething = mutation({
 *   args: {/* ... *\/},
 *   handler: async (ctx, args) => {
 *     const sessionId = await getAuthSessionId(ctx);
 *     if (sessionId === null) {
 *       throw new Error("Client is not authenticated!")
 *     }
 *     const session = await ctx.db.get(sessionId);
 *     // ...
 *   },
 * });
 * ```
 *
 * @param ctx query, mutation or action `ctx`
 * @returns the session ID or `null` if the client isn't authenticated
 */
export async function getAuthSessionId(ctx: { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    return null;
  }
  const [, sessionId] = identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER);
  return sessionId as GenericId<"session">;
}
