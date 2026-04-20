import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import type { AuthTokens } from "../../shared/authResults";
import type * as Provider from "../crypto";
import { authDb } from "../db";
import { log, maybeRedact } from "../log";
import {
  parseRefreshToken,
  REFRESH_TOKEN_REUSE_WINDOW_MS,
  refreshTokenExpirationTime,
} from "../refresh";
import { REFRESH_TOKEN_DIVIDER } from "../refresh";
import { finalizeSessionIssuance } from "../sessions";
import type { SessionIssuance } from "../sessions";
import { buildRefreshIdentityAttributes } from "../telemetry";
import {
  GenericActionCtxWithAuthConfig,
  type Doc,
  type MutationCtx,
  type SessionInfo,
} from "../types";
import { setActiveSpanAttributes, withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const refreshSessionArgs = v.object({
  refreshToken: v.string(),
});

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

  return withSpan(
    "convex-auth.refresh.session",
    { hasRefreshToken: true, "auth.flow": "refresh" },
    async () => {
      try {
        let refreshTokenId: GenericId<"RefreshToken">;
        let sessionId: GenericId<"Session">;
        try {
          ({ refreshTokenId, sessionId } = parseRefreshToken(args.refreshToken));
        } catch {
          throw new RefreshFailure("parse_failure", "Failed to parse refresh token");
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
          throw new RefreshFailure("exchange_failure", "Failed to exchange refresh token");
        }

        if (exchanged === null) {
          setActiveSpanAttributes({ "auth.refresh.result": "null" });
          return null;
        }

        setActiveSpanAttributes({
          "auth.refresh.result": "success",
          ...(await buildRefreshIdentityAttributes(ctx, config, {
            userId: exchanged.userId,
            sessionId: exchanged.sessionId,
            refreshTokenId: exchanged.refreshTokenId,
          })),
        });

        const user = (await db.users.getById(exchanged.userId)) as Doc<"User"> | null;

        return {
          userId: exchanged.userId as GenericId<"User">,
          sessionId: exchanged.sessionId as GenericId<"Session">,
          identity: {
            subject: exchanged.userId as GenericId<"User">,
            sessionId: exchanged.sessionId as GenericId<"Session">,
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
          },
          refreshToken: `${exchanged.refreshTokenId as string}${REFRESH_TOKEN_DIVIDER}${exchanged.sessionId as string}`,
        } satisfies SessionIssuance;
      } catch (e) {
        if (e instanceof RefreshFailure) {
          setActiveSpanAttributes({
            "auth.refresh.result": e.code,
            "auth.refresh.failure_reason": e.reason,
          });
          log("DEBUG", e.reason);
          return null;
        }
        throw e;
      }
    },
  );
}

class RefreshFailure extends Error {
  constructor(
    public code: "parse_failure" | "exchange_failure",
    public reason: string,
  ) {
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
): Promise<SessionInfo<AuthTokens> | null> => {
  const issuance = (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "refreshSession",
      ...args,
    },
  })) as SessionIssuance | null;
  if (issuance === null || issuance.refreshToken === null) {
    return null;
  }
  return (await finalizeSessionIssuance(ctx.auth.config, issuance)) as SessionInfo<AuthTokens>;
};
