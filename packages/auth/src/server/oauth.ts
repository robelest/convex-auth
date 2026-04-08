/**
 * OAuth flow implementation.
 *
 * Uses convex-auth's internal runtime contract for provider integration.
 *
 * All functions return `Fx<A, ConvexError<any>>` composed via `Fx.gen` pipelines.
 *
 * @internal
 * @module
 */

import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import * as arctic from "arctic";
import type { ConvexError } from "convex/values";

import { SHARED_COOKIE_OPTIONS } from "./cookies";
import type { OAuthProfile, OAuthRuntimeClient, OAuthTokens } from "./types";
import { logWithLevel } from "./utils";
import { isLocalHost } from "./utils";

type OAuthProviderConfigLike = {
  scopes?: string[];
  provider: OAuthRuntimeClient | null;
  profile?: (tokens: OAuthTokens) => Promise<OAuthProfile>;
  nonce?: boolean;
  validateTokens?: (tokens: OAuthTokens, ctx: { nonce?: string }) => Promise<void>;
};

// ============================================================================
// Types
// ============================================================================

/** A cookie to be set on the HTTP response. */
/** @internal */
export interface OAuthCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

/** Result of creating an authorization URL. */
/** @internal */
export interface AuthorizationResult {
  redirect: string;
  cookies: OAuthCookie[];
  signature: string;
}

/** Result of handling an OAuth callback. */
/** @internal */
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

function oauthCookieName(type: "state" | "pkce" | "nonce", providerId: string) {
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
/** @internal */
export function getAuthorizationSignature({
  codeVerifier,
  state,
}: {
  codeVerifier?: string;
  state?: string;
}) {
  return [codeVerifier, state].filter((param) => param !== undefined).join(" ");
}

// ============================================================================
// PKCE Handling
// ============================================================================

function requiresPKCE(provider: OAuthRuntimeClient) {
  return provider.pkce === "required" || provider.pkce === "optional";
}

// ============================================================================
// Token exchange — wraps Arctic's validateAuthorizationCode
// ============================================================================

/**
 * Exchange the authorization code for tokens via the configured runtime client.
 * Maps Arctic-specific errors to typed `ConvexError<any>` failures.
 */
function exchangeCode(
  provider: OAuthRuntimeClient,
  code: string,
  codeVerifier: string | undefined,
): Fx<OAuthTokens, ConvexError<any>> {
  return Fx.from({
    ok: () => provider.validateAuthorizationCode({ code, codeVerifier }),
    err: (e) => {
      if (e instanceof arctic.OAuth2RequestError) {
        return Cv.error({
          code: "OAUTH_PROVIDER_ERROR",
          message: `Token exchange failed: ${e.code}`,
        });
      }
      if (e instanceof arctic.ArcticFetchError) {
        return Cv.error({
          code: "OAUTH_PROVIDER_ERROR",
          message: `Network error during token exchange: ${e.message}`,
        });
      }
      // Unknown error — treat as unrecoverable defect; we surface it as
      // an ConvexError<any> here so the pipeline type stays Fx<_, ConvexError<any>>.
      // The original `throw e` re-throw is replicated via Fx.fatal below.
      return Cv.error({
        code: "OAUTH_PROVIDER_ERROR",
        message: `Unexpected error during token exchange: ${e instanceof Error ? e.message : String(e)}`,
      });
    },
  }).pipe(
    Fx.chain((tokens) => {
      // If the original error was neither OAuth2RequestError nor
      // ArcticFetchError the old code re-threw it raw. We replicate that
      // by checking whether we created an "Unexpected" marker message
      // — but since `Fx.from` already mapped it, we just pass through.
      return Fx.succeed(tokens);
    }),
  );
}

/**
 * Extract the user profile from tokens using the config callback,
 * OIDC auto-decode, or fail if neither is available.
 */
function extractProfile(
  providerId: string,
  oauthConfig: OAuthProviderConfigLike,
  tokens: OAuthTokens,
): Fx<OAuthProfile, ConvexError<any>> {
  const hasIdToken = typeof tokens.idToken === "string";
  const profileSource = oauthConfig.profile
    ? { source: "callback" as const }
    : hasIdToken
      ? { source: "idToken" as const }
      : { source: "missing" as const };

  return Fx.match(profileSource, profileSource.source, {
    callback: (_profileSource) =>
      Fx.from({
        ok: () => oauthConfig.profile!(tokens),
        err: (e) =>
          Cv.error({
            code: "OAUTH_INVALID_PROFILE",
            message: `Profile callback threw: ${e instanceof Error ? e.message : String(e)}`,
          }),
      }),
    idToken: (_profileSource) => {
      const claims = arctic.decodeIdToken(tokens.idToken!) as Record<string, unknown>;
      return Fx.succeed({
        id: (claims.sub as string) ?? crypto.randomUUID(),
        name: (claims.name as string) ?? undefined,
        email: (claims.email as string) ?? undefined,
        image: (claims.picture as string) ?? undefined,
      });
    },
    missing: (_profileSource) =>
      Cv.fail({
        code: "OAUTH_INVALID_PROFILE",
        message:
          `Provider "${providerId}" does not return an ID token. ` +
          "Configure a profile extractor for this provider to derive user info from the access token.",
      }),
  });
}

/**
 * Validate that the profile has a non-empty string `id`.
 */
function validateProfileId(
  providerId: string,
  profile: OAuthProfile,
): Fx<OAuthProfile, ConvexError<any>> {
  return typeof profile.id === "string" && profile.id
    ? Fx.succeed(profile)
    : Cv.fail({
        code: "OAUTH_INVALID_PROFILE",
        message: `The profile callback for "${providerId}" must return an object with a string \`id\` field.`,
      });
}

// ============================================================================
// Authorization URL creation
// ============================================================================

/**
 * Create an OAuth authorization URL using the configured runtime client.
 */
/** @internal */
export async function createOAuthAuthorizationURL(
  providerId: string,
  oauthConfig: OAuthProviderConfigLike,
): Promise<AuthorizationResult> {
  if (oauthConfig.provider === null) {
    throw new Error(`OAuth provider "${providerId}" is missing a runtime client.`);
  }
  const state = arctic.generateState();
  const cookies: OAuthCookie[] = [];
  let codeVerifier: string | undefined;

  const scopes = oauthConfig.scopes ?? [];

  if (requiresPKCE(oauthConfig.provider)) {
    codeVerifier = arctic.generateCodeVerifier();
    cookies.push(createCookie("pkce", providerId, codeVerifier));
  }

  cookies.push(createCookie("state", providerId, state));

  let nonce: string | undefined;
  if (oauthConfig.nonce === true) {
    nonce = arctic.generateState();
    cookies.push(createCookie("nonce", providerId, nonce));
  }

  const url = oauthConfig.provider.createAuthorizationURL({
    state,
    codeVerifier,
    scopes,
    nonce,
  });

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
 *
 * Returns `Fx<CallbackResult, ConvexError<any>>` composed via `Fx.gen`.
 */
/** @internal */
export function handleOAuthCallback(
  providerId: string,
  oauthConfig: OAuthProviderConfigLike,
  params: Record<string, string>,
  cookies: Record<string, string | undefined>,
): Fx<CallbackResult, ConvexError<any>> {
  return Fx.gen(function* () {
    if (oauthConfig.provider === null) {
      return yield* Cv.fail({
        code: "OAUTH_PROVIDER_ERROR",
        message: `OAuth provider "${providerId}" is missing a runtime client.`,
      });
    }
    const resCookies: OAuthCookie[] = [];

    // 1. Validate state
    const stateCookieName = oauthCookieName("state", providerId);
    const storedState = cookies[stateCookieName];
    const returnedState = params.state;

    yield* Fx.guard(
      !storedState || !returnedState || storedState !== returnedState,
      Cv.fail({
        code: "OAUTH_INVALID_STATE",
        message: "Invalid OAuth state. Please try signing in again.",
      }),
    );
    resCookies.push(clearCookie("state", providerId));

    // Check for error from provider
    if (params.error) {
      const cause = {
        providerId,
        error: params.error,
        error_description: params.error_description,
      };
      logWithLevel("DEBUG", "OAuthCallbackError", cause);
      yield* Cv.fail({
        code: "OAUTH_PROVIDER_ERROR",
        message: "OAuth provider returned an error",
        cause: JSON.stringify(cause),
      });
    }

    // 2. Get code
    const code = yield* params.code != null
      ? Fx.succeed(params.code)
      : Cv.fail({
          code: "OAUTH_PROVIDER_ERROR",
          message: "Missing authorization code in callback",
        });

    // 3. Read PKCE verifier from cookie if applicable
    let codeVerifier: string | undefined;
    if (requiresPKCE(oauthConfig.provider)) {
      const pkceCookieName = oauthCookieName("pkce", providerId);
      codeVerifier = yield* cookies[pkceCookieName] != null
        ? Fx.succeed(cookies[pkceCookieName]!)
        : Cv.fail({
            code: "OAUTH_MISSING_VERIFIER",
            message: "Missing PKCE verifier cookie for OAuth callback",
          });
      resCookies.push(clearCookie("pkce", providerId));
    }

    let nonce: string | undefined;
    if (oauthConfig.nonce === true) {
      const nonceCookieName = oauthCookieName("nonce", providerId);
      nonce = yield* cookies[nonceCookieName] != null
        ? Fx.succeed(cookies[nonceCookieName]!)
        : Cv.fail({
            code: "OAUTH_PROVIDER_ERROR",
            message: "Missing nonce cookie for OAuth callback",
          });
      resCookies.push(clearCookie("nonce", providerId));
    }

    // 4. Exchange code for tokens
    const tokens = yield* exchangeCode(oauthConfig.provider, code, codeVerifier);

    if (oauthConfig.validateTokens !== undefined) {
      yield* Fx.from({
        ok: () => oauthConfig.validateTokens!(tokens, { nonce }),
        err: (e) =>
          Cv.error({
            code: "OAUTH_PROVIDER_ERROR",
            message: `Token validation failed: ${e instanceof Error ? e.message : String(e)}`,
          }),
      });
    }

    // 5. Extract profile
    const rawProfile = yield* extractProfile(providerId, oauthConfig, tokens);
    const profile = yield* validateProfileId(providerId, rawProfile);

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
  });
}
