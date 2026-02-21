/**
 * Arctic-based OAuth flow implementation.
 *
 * Uses Arctic for OAuth provider integration.
 *
 * @internal
 * @module
 */

import * as arctic from "arctic";
import { SHARED_COOKIE_OPTIONS } from "./cookies";
import { requireEnv, isLocalHost } from "./utils";
import { logWithLevel } from "./implementation/utils";
import { throwAuthError } from "./errors";
import type { OAuthProviderConfig, OAuthProfile } from "./types";

// ============================================================================
// Types
// ============================================================================

/** A cookie to be set on the HTTP response. */
export interface OAuthCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/** Result of creating an authorization URL. */
export interface AuthorizationResult {
  redirect: string;
  cookies: OAuthCookie[];
  signature: string;
}

/** Result of handling an OAuth callback. */
export interface CallbackResult {
  profile: OAuthProfile;
  providerAccountId: string;
  cookies: OAuthCookie[];
  signature: string;
}

// ============================================================================
// Cookie helpers
// ============================================================================

const COOKIE_TTL = 60 * 15; // 15 minutes

function oauthCookieName(
  type: "state" | "pkce" | "nonce",
  providerId: string,
) {
  const prefix = !isLocalHost(process.env.CONVEX_SITE_URL) ? "__Host-" : "";
  return prefix + providerId + "OAuth" + type;
}

function createCookie(
  type: "state" | "pkce" | "nonce",
  providerId: string,
  value: string,
): OAuthCookie {
  const expires = new Date();
  expires.setTime(expires.getTime() + COOKIE_TTL * 1000);
  return {
    name: oauthCookieName(type, providerId),
    value,
    options: { ...SHARED_COOKIE_OPTIONS, expires },
  };
}

function clearCookie(
  type: "state" | "pkce" | "nonce",
  providerId: string,
): OAuthCookie {
  return {
    name: oauthCookieName(type, providerId),
    value: "",
    options: { ...SHARED_COOKIE_OPTIONS, maxAge: 0 },
  };
}

// ============================================================================
// Signature (ConvexAuth-specific verifier mechanism)
// ============================================================================

/**
 * Creates a signature string from the OAuth state parameters.
 * This is stored in the verifier table and validated during callback.
 */
export function getAuthorizationSignature({
  codeVerifier,
  state,
}: {
  codeVerifier?: string;
  state?: string;
}) {
  return [codeVerifier, state]
    .filter((param) => param !== undefined)
    .join(" ");
}

// ============================================================================
// Callback URL
// ============================================================================

export function callbackUrl(providerId: string) {
  return (
    (process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL")) +
    "/api/auth/callback/" +
    providerId
  );
}

// ============================================================================
// PKCE Detection
// ============================================================================

/**
 * Detect whether an Arctic provider uses PKCE by checking the arity
 * of `createAuthorizationURL`. PKCE providers take 3 args
 * (state, codeVerifier, scopes), non-PKCE take 2 (state, scopes).
 */
function isPKCEProvider(provider: any): boolean {
  return (
    typeof provider.createAuthorizationURL === "function" &&
    provider.createAuthorizationURL.length >= 3
  );
}

// ============================================================================
// OIDC Detection (post-token-exchange)
// ============================================================================

function hasIdToken(tokens: arctic.OAuth2Tokens): boolean {
  return (
    "id_token" in tokens.data &&
    typeof (tokens.data as any).id_token === "string"
  );
}

// ============================================================================
// Default profile extraction from OIDC ID token
// ============================================================================

function defaultOIDCProfile(tokens: arctic.OAuth2Tokens): OAuthProfile {
  const claims = arctic.decodeIdToken(tokens.idToken()) as Record<
    string,
    unknown
  >;
  return {
    id: (claims.sub as string) ?? crypto.randomUUID(),
    name: (claims.name as string) ?? undefined,
    email: (claims.email as string) ?? undefined,
    image: (claims.picture as string) ?? undefined,
  };
}

// ============================================================================
// Authorization URL creation
// ============================================================================

/**
 * Create an OAuth authorization URL using an Arctic provider.
 *
 * Handles PKCE detection, state generation, and cookie creation.
 */
export async function createOAuthAuthorizationURL(
  providerId: string,
  arcticProvider: any,
  oauthConfig: OAuthProviderConfig,
): Promise<AuthorizationResult> {
  const state = arctic.generateState();
  const cookies: OAuthCookie[] = [];
  let codeVerifier: string | undefined;

  const scopes = oauthConfig.scopes ?? [];

  let url: URL;

  if (isPKCEProvider(arcticProvider)) {
    codeVerifier = arctic.generateCodeVerifier();
    url = arcticProvider.createAuthorizationURL(state, codeVerifier, scopes);
    cookies.push(createCookie("pkce", providerId, codeVerifier));
  } else {
    url = arcticProvider.createAuthorizationURL(state, scopes);
  }

  cookies.push(createCookie("state", providerId, state));

  logWithLevel("DEBUG", "OAuth authorization URL created", {
    url: url.toString(),
    providerId,
    hasPKCE: !!codeVerifier,
  });

  const signature = getAuthorizationSignature({ codeVerifier, state });

  return {
    redirect: url.toString(),
    cookies,
    signature,
  };
}

// ============================================================================
// OAuth callback handling
// ============================================================================

/**
 * Handle the OAuth callback: validate state, exchange code for tokens,
 * extract profile.
 */
export async function handleOAuthCallback(
  providerId: string,
  arcticProvider: any,
  oauthConfig: OAuthProviderConfig,
  params: Record<string, string>,
  cookies: Record<string, string | undefined>,
): Promise<CallbackResult> {
  const resCookies: OAuthCookie[] = [];

  // 1. Validate state
  const stateCookieName = oauthCookieName("state", providerId);
  const storedState = cookies[stateCookieName];
  const returnedState = params.state;

  if (!storedState || !returnedState || storedState !== returnedState) {
    throwAuthError("OAUTH_INVALID_STATE");
  }
  resCookies.push(clearCookie("state", providerId));

  // Check for error from provider
  if (params.error) {
    const cause = { providerId, error: params.error, error_description: params.error_description };
    logWithLevel("DEBUG", "OAuthCallbackError", cause);
    throwAuthError("OAUTH_PROVIDER_ERROR", "OAuth provider returned an error", {
      cause: JSON.stringify(cause),
    });
  }

  // 2. Get code
  const code = params.code;
  if (!code) {
    throwAuthError("OAUTH_PROVIDER_ERROR", "Missing authorization code in callback");
  }

  // 3. Read PKCE verifier from cookie if applicable
  let codeVerifier: string | undefined;
  if (isPKCEProvider(arcticProvider)) {
    const pkceCookieName = oauthCookieName("pkce", providerId);
    codeVerifier = cookies[pkceCookieName];
    if (codeVerifier === undefined) {
      throwAuthError(
        "OAUTH_MISSING_VERIFIER",
        "Missing PKCE verifier cookie for OAuth callback",
      );
    }
    resCookies.push(clearCookie("pkce", providerId));
  }

  // 4. Exchange code for tokens
  let tokens: arctic.OAuth2Tokens;
  try {
    if (isPKCEProvider(arcticProvider)) {
      tokens = await arcticProvider.validateAuthorizationCode(code, codeVerifier);
    } else {
      tokens = await arcticProvider.validateAuthorizationCode(code);
    }
  } catch (e) {
    if (e instanceof arctic.OAuth2RequestError) {
      throwAuthError("OAUTH_PROVIDER_ERROR", `Token exchange failed: ${e.code}`);
    }
    if (e instanceof arctic.ArcticFetchError) {
      throwAuthError("OAUTH_PROVIDER_ERROR", `Network error during token exchange: ${e.message}`);
    }
    throw e;
  }

  // 5. Extract profile
  let profile: OAuthProfile;

  if (oauthConfig.profile) {
    // User-provided profile callback
    profile = await oauthConfig.profile(tokens);
  } else if (hasIdToken(tokens)) {
    // OIDC — auto-decode ID token
    profile = defaultOIDCProfile(tokens);
  } else {
    throwAuthError(
      "OAUTH_INVALID_PROFILE",
      `Provider "${providerId}" does not return an ID token. ` +
        `Add a \`profile\` callback in the OAuth() config to extract user info from the access token.`,
    );
  }

  if (typeof profile.id !== "string" || !profile.id) {
    throwAuthError(
      "OAUTH_INVALID_PROFILE",
      `The profile callback for "${providerId}" must return an object with a string \`id\` field.`,
    );
  }

  logWithLevel("DEBUG", "OAuth callback profile extracted", {
    providerId,
    profileId: profile.id,
  });

  // 6. Compute signature for verifier validation
  const state = storedState!;
  const signature = getAuthorizationSignature({ codeVerifier, state });

  return {
    profile,
    providerAccountId: profile.id,
    cookies: resCookies,
    signature,
  };
}
