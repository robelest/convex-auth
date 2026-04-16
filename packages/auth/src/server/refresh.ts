import { ConvexError, GenericId } from "convex/values";

import { envOptionalNumber, readConfigSync } from "./env";
import { maybeRedact } from "./log";
import type { ConvexAuthConfig } from "./types";

export const REFRESH_TOKEN_DIVIDER = "|";

const DEFAULT_SESSION_INACTIVE_DURATION_MS = 1000 * 60 * 60 * 24 * 30;
/** @internal */
export const REFRESH_TOKEN_REUSE_WINDOW_MS = 10 * 1000;

export const refreshTokenExpirationTime = (
  config: ConvexAuthConfig,
  now = Date.now(),
) =>
  now +
  (config.session?.inactiveDurationMs ??
    readConfigSync(envOptionalNumber("AUTH_SESSION_INACTIVE_DURATION_MS")) ??
    DEFAULT_SESSION_INACTIVE_DURATION_MS);

/** @internal */
export const parseRefreshToken = (
  refreshToken: string,
): {
  refreshTokenId: GenericId<"RefreshToken">;
  sessionId: GenericId<"Session">;
} => {
  const [refreshTokenId, sessionId] = refreshToken.split(REFRESH_TOKEN_DIVIDER);
  const message = `Can't parse refresh token: ${maybeRedact(refreshToken)}`;
  if (refreshTokenId == null || sessionId == null) {
    throw new ConvexError({ code: "INVALID_REFRESH_TOKEN", message });
  }
  return {
    refreshTokenId: refreshTokenId as GenericId<"RefreshToken">,
    sessionId: sessionId as GenericId<"Session">,
  };
};
