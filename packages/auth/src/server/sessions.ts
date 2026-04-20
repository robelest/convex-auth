import { Auth } from "convex/server";
import { GenericId } from "convex/values";

import { authDb } from "./db";
import { envOptionalNumber, readConfigSync } from "./env";
import { getAuthenticatedSessionIdOrNull } from "./identity";
import { LOG_LEVELS, log, maybeRedact } from "./log";
import { REFRESH_TOKEN_DIVIDER, refreshTokenExpirationTime } from "./refresh";
import { generateToken } from "./tokens";
import {
  ConvexAuthConfig,
  Doc,
  MutationCtx,
  SessionInfo,
  SessionTokenIdentityClaims,
} from "./types";
import { withSpan } from "./utils/span";

const DEFAULT_SESSION_TOTAL_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export const sessionExpirationTime = (config: ConvexAuthConfig, now = Date.now()) =>
  now +
  (config.session?.totalDurationMs ??
    readConfigSync(envOptionalNumber("AUTH_SESSION_TOTAL_DURATION_MS")) ??
    DEFAULT_SESSION_TOTAL_DURATION_MS);

const encodeRefreshToken = (
  refreshTokenId: GenericId<"RefreshToken">,
  sessionId: GenericId<"Session">,
) => `${refreshTokenId}${REFRESH_TOKEN_DIVIDER}${sessionId}`;

/**
 * Mutation-side session issuance result. The mutation creates the session
 * and refresh-token rows; JWT signing happens on the action side so the
 * transaction commits without paying the signing CPU cost.
 */
export type SessionIssuance = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
  identity: SessionTokenIdentityClaims;
  /**
   * Encoded refresh token (`${refreshTokenId}|${sessionId}`), or `null` when
   * the caller opted out of refresh-token issuance (e.g. TOTP step-up).
   */
  refreshToken: string | null;
};

function buildSessionIdentity(
  userId: GenericId<"User">,
  sessionId: GenericId<"Session">,
  user: Doc<"User"> | null,
): SessionTokenIdentityClaims {
  return {
    subject: userId,
    sessionId,
    ...(typeof user?.name === "string" ? { name: user.name } : null),
    ...(typeof user?.email === "string" ? { email: user.email } : null),
    ...(user?.emailVerificationTime !== undefined
      ? { emailVerified: true }
      : user?.email !== undefined
        ? { emailVerified: false }
        : null),
    ...(typeof user?.image === "string" ? { picture: user.image } : null),
    ...(typeof user?.phone === "string" ? { phoneNumber: user.phone } : null),
    ...(user?.phoneVerificationTime !== undefined
      ? { phoneNumberVerified: true }
      : user?.phone !== undefined
        ? { phoneNumberVerified: false }
        : null),
  };
}

/**
 * Convert a {@link SessionIssuance} returned from a mutation into the
 * external `SessionInfo` shape by signing the JWT on the action side.
 *
 * Must be called from an action context because `generateToken` performs
 * RSA-2048 JWT signing that would otherwise block the mutation commit.
 *
 * @internal
 */
export async function finalizeSessionIssuance(
  config: ConvexAuthConfig,
  issuance: SessionIssuance,
): Promise<SessionInfo> {
  return withSpan(
    "convex-auth.session.finalize",
    { hasRefreshToken: issuance.refreshToken !== null },
    async () => {
      if (issuance.refreshToken === null) {
        return {
          userId: issuance.userId,
          sessionId: issuance.sessionId,
          tokens: null,
        };
      }
      const token = await generateToken({ identity: issuance.identity }, config);
      log(
        LOG_LEVELS.DEBUG,
        `Generated token ${maybeRedact(token)} and refresh token ${maybeRedact(issuance.refreshToken)} for session ${maybeRedact(issuance.sessionId)}`,
      );
      return {
        userId: issuance.userId,
        sessionId: issuance.sessionId,
        tokens: { token, refreshToken: issuance.refreshToken },
      };
    },
  );
}

/** @internal */
export async function issueSession(
  ctx: MutationCtx,
  config: ConvexAuthConfig,
  args: {
    userId: GenericId<"User">;
    existingSessionId?: GenericId<"Session">;
    replaceSessionId?: GenericId<"Session">;
    generateTokens: boolean;
  },
): Promise<SessionIssuance> {
  const db = authDb(ctx, config);
  const issued = await db.sessions.issue({
    userId: args.userId,
    sessionId: args.existingSessionId,
    replaceSessionId: args.replaceSessionId,
    sessionExpirationTime: sessionExpirationTime(config),
    refreshTokenExpirationTime: args.generateTokens
      ? refreshTokenExpirationTime(config)
      : undefined,
  });
  const sessionId = issued.sessionId as GenericId<"Session">;
  const refreshTokenId = issued.refreshTokenId as GenericId<"RefreshToken"> | undefined;
  const user = (await db.users.getById(issued.userId)) as Doc<"User"> | null;
  return {
    userId: issued.userId as GenericId<"User">,
    sessionId,
    identity: buildSessionIdentity(issued.userId as GenericId<"User">, sessionId, user),
    refreshToken:
      args.generateTokens && refreshTokenId !== undefined
        ? encodeRefreshToken(refreshTokenId, sessionId)
        : null,
  };
}

/** @internal */
export async function generateTokensForSession(
  config: ConvexAuthConfig,
  args: {
    identity: SessionTokenIdentityClaims;
    refreshTokenId: GenericId<"RefreshToken">;
  },
) {
  const result = {
    token: await generateToken({ identity: args.identity }, config),
    refreshToken: encodeRefreshToken(args.refreshTokenId, args.identity.sessionId),
  };
  log(
    LOG_LEVELS.DEBUG,
    `Generated token ${maybeRedact(result.token)} and refresh token ${maybeRedact(args.refreshTokenId)} for session ${maybeRedact(args.identity.sessionId)}`,
  );
  return result;
}

/** @internal */
export async function deleteSession(
  ctx: MutationCtx,
  session: Doc<"Session">,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  await db.sessions.delete(session._id);
  await db.refreshTokens.deleteAll(session._id);
}

/**
 * Return the current session ID from the auth identity subject.
 *
 * Internal helper used by auth runtime internals.
 */
/** @internal */
export async function getAuthSessionId(ctx: { auth: Auth }) {
  return await getAuthenticatedSessionIdOrNull(ctx);
}
