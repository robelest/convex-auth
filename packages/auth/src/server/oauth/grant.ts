import type { OAuthClientDoc } from "./client";

/**
 * Why a client-grant check failed. Each trust boundary maps these to its own
 * wire format (302 redirect / `ConvexError` / OAuth JSON) — see the three call
 * sites (`authorize.ts` handler, `code.ts` domain, `token.ts` handler).
 */
export type OAuthGrantDenial =
  | { reason: "client_not_found" }
  | { reason: "redirect_uri_mismatch" }
  | { reason: "grant_type_not_allowed" }
  | { reason: "scope_not_allowed"; disallowed: string[] };

/** Discriminated result of validating a client-grant request. */
export type OAuthGrantResult =
  | { ok: true; client: OAuthClientDoc; scopes: string[] }
  | { ok: false; denial: OAuthGrantDenial };

/**
 * The single source of truth for "client active, redirect_uri registered, grant
 * type allowed, requested scopes ⊆ client.scopes". Pure — the caller loads
 * `client` through its own trust path (cached `getClient`, or `verifyClientSecret`)
 * and formats `denial` per its boundary; the security checks are NOT collapsed,
 * only the duplicated predicate.
 *
 * Check order is fixed (client → redirect_uri → grant_type → scope), matching
 * what all three call sites already do. `redirectUri` is omitted for grants
 * without a redirect (`client_credentials`). On success, `scopes` is the
 * resolved effective set: the requested scopes, or — when `requestedScopes` is
 * empty and `grantType` is `client_credentials` — the client's full set.
 */
export function checkOAuthGrant(args: {
  client: OAuthClientDoc | null;
  grantType: "authorization_code" | "client_credentials" | "refresh_token";
  redirectUri?: string;
  requestedScopes: string[];
}): OAuthGrantResult {
  const { client, grantType, redirectUri, requestedScopes } = args;
  if (!client || client.revoked) {
    return { ok: false, denial: { reason: "client_not_found" } };
  }
  if (redirectUri !== undefined && !client.redirectUris.includes(redirectUri)) {
    return { ok: false, denial: { reason: "redirect_uri_mismatch" } };
  }
  if (!client.grantTypes.includes(grantType)) {
    return { ok: false, denial: { reason: "grant_type_not_allowed" } };
  }
  const disallowed = requestedScopes.filter((s) => !client.scopes.includes(s));
  if (disallowed.length > 0) {
    return { ok: false, denial: { reason: "scope_not_allowed", disallowed } };
  }
  const scopes =
    requestedScopes.length > 0
      ? requestedScopes
      : grantType === "client_credentials"
        ? client.scopes
        : requestedScopes;
  return { ok: true, client, scopes };
}
