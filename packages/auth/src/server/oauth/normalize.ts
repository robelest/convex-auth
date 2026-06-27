/**
 * Normalize a raw OAuth token endpoint response into the stable
 * {@link OAuthTokens} contract.
 *
 * @module
 */

import type { OAuthTokens } from "../types";

/**
 * Convert a raw OAuth/OIDC token response body into {@link OAuthTokens},
 * extracting the standard `access_token`, `refresh_token`, and `id_token`
 * fields, converting `expires_in` (seconds) into an absolute expiry `Date`,
 * and splitting the space/comma-delimited `scope` string into an array.
 *
 * The original response body is preserved on `raw`.
 *
 * @internal
 */
export function normalizeOAuthTokenResponse(raw: Record<string, unknown>): OAuthTokens {
  const rawScopes = typeof raw.scope === "string" ? raw.scope : undefined;
  const expiresInSeconds = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    accessToken: typeof raw.access_token === "string" ? raw.access_token : undefined,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    idToken: typeof raw.id_token === "string" ? raw.id_token : undefined,
    accessTokenExpiresAt:
      expiresInSeconds === undefined ? undefined : new Date(Date.now() + expiresInSeconds * 1000),
    scopes: rawScopes
      ? rawScopes
          .split(/[\s,]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : undefined,
    raw,
  };
}
