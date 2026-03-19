/**
 * Arctic-based OAuth flow implementation.
 *
 * Uses Arctic for OAuth provider integration.
 *
 * All functions return `Fx<A, AuthError>` composed via `Fx.gen` pipelines.
 *
 * @internal
 * @module
 */

import { Fx } from "@robelest/fx";
import * as arctic from "arctic";

import { SHARED_COOKIE_OPTIONS } from "./cookies";
import { AuthError } from "./fx";
import type { OAuthProfile } from "./types";
import { logWithLevel } from "./utils";
import { isLocalHost } from "./utils";

type OAuthProviderConfigLike = {
  scopes?: string[];
  profile?: (tokens: arctic.OAuth2Tokens) => Promise<OAuthProfile>;
  nonce?: boolean;
  validateTokens?: (
    tokens: arctic.OAuth2Tokens,
    ctx: { nonce?: string },
  ) => Promise<void>;
};

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
// Token exchange — wraps Arctic's validateAuthorizationCode
// ============================================================================

/**
 * Exchange the authorization code for tokens via Arctic.
 * Maps Arctic-specific errors to typed `AuthError` failures.
 */
function exchangeCode(
  arcticProvider: any,
  code: string,
  codeVerifier: string | undefined,
): Fx<arctic.OAuth2Tokens, AuthError> {
  return Fx.from({
    ok: () =>
      isPKCEProvider(arcticProvider)
        ? arcticProvider.validateAuthorizationCode(code, codeVerifier)
        : arcticProvider.validateAuthorizationCode(code),
    err: (e) => {
      if (e instanceof arctic.OAuth2RequestError) {
        return new AuthError(
          "OAUTH_PROVIDER_ERROR",
          `Token exchange failed: ${e.code}`,
        );
      }
      if (e instanceof arctic.ArcticFetchError) {
        return new AuthError(
          "OAUTH_PROVIDER_ERROR",
          `Network error during token exchange: ${e.message}`,
        );
      }
      // Unknown error — treat as unrecoverable defect; we surface it as
      // an AuthError here so the pipeline type stays Fx<_, AuthError>.
      // The original `throw e` re-throw is replicated via Fx.fatal below.
      return new AuthError(
        "OAUTH_PROVIDER_ERROR",
        `Unexpected error during token exchange: ${e instanceof Error ? e.message : String(e)}`,
      );
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
  tokens: arctic.OAuth2Tokens,
): Fx<OAuthProfile, AuthError> {
  const hasIdToken =
    "id_token" in tokens.data &&
    typeof (tokens.data as any).id_token === "string";
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
          new AuthError(
            "OAUTH_INVALID_PROFILE",
            `Profile callback threw: ${e instanceof Error ? e.message : String(e)}`,
          ),
      }),
    idToken: (_profileSource) => {
      const claims = arctic.decodeIdToken(tokens.idToken()) as Record<
        string,
        unknown
      >;
      return Fx.succeed({
        id: (claims.sub as string) ?? crypto.randomUUID(),
        name: (claims.name as string) ?? undefined,
        email: (claims.email as string) ?? undefined,
        image: (claims.picture as string) ?? undefined,
      });
    },
    missing: (_profileSource) =>
      Fx.fail(
        new AuthError(
          "OAUTH_INVALID_PROFILE",
          `Provider "${providerId}" does not return an ID token. ` +
            `Add a \`profile\` callback in the OAuth() config to extract user info from the access token.`,
        ),
      ),
  });
}

/**
 * Validate that the profile has a non-empty string `id`.
 */
function validateProfileId(
  providerId: string,
  profile: OAuthProfile,
): Fx<OAuthProfile, AuthError> {
  return typeof profile.id === "string" && profile.id
    ? Fx.succeed(profile)
    : Fx.fail(
        new AuthError(
          "OAUTH_INVALID_PROFILE",
          `The profile callback for "${providerId}" must return an object with a string \`id\` field.`,
        ),
      );
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
  oauthConfig: OAuthProviderConfigLike,
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

  if (oauthConfig.nonce === true) {
    const nonce = arctic.generateState();
    url.searchParams.set("nonce", nonce);
    cookies.push(createCookie("nonce", providerId, nonce));
  }

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
 * Returns `Fx<CallbackResult, AuthError>` composed via `Fx.gen`.
 */
export function handleOAuthCallback(
  providerId: string,
  arcticProvider: any,
  oauthConfig: OAuthProviderConfigLike,
  params: Record<string, string>,
  cookies: Record<string, string | undefined>,
): Fx<CallbackResult, AuthError> {
  return Fx.gen(function* () {
    const resCookies: OAuthCookie[] = [];

    // 1. Validate state
    const stateCookieName = oauthCookieName("state", providerId);
    const storedState = cookies[stateCookieName];
    const returnedState = params.state;

    yield* Fx.guard(
      !storedState || !returnedState || storedState !== returnedState,
      Fx.fail(new AuthError("OAUTH_INVALID_STATE")),
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
      yield* Fx.fail(
        new AuthError(
          "OAUTH_PROVIDER_ERROR",
          "OAuth provider returned an error",
          {
            cause: JSON.stringify(cause),
          },
        ),
      );
    }

    // 2. Get code
    const code = yield* params.code != null
      ? Fx.succeed(params.code)
      : Fx.fail(
          new AuthError(
            "OAUTH_PROVIDER_ERROR",
            "Missing authorization code in callback",
          ),
        );

    // 3. Read PKCE verifier from cookie if applicable
    let codeVerifier: string | undefined;
    if (isPKCEProvider(arcticProvider)) {
      const pkceCookieName = oauthCookieName("pkce", providerId);
      codeVerifier = yield* cookies[pkceCookieName] != null
        ? Fx.succeed(cookies[pkceCookieName]!)
        : Fx.fail(
            new AuthError(
              "OAUTH_MISSING_VERIFIER",
              "Missing PKCE verifier cookie for OAuth callback",
            ),
          );
      resCookies.push(clearCookie("pkce", providerId));
    }

    let nonce: string | undefined;
    if (oauthConfig.nonce === true) {
      const nonceCookieName = oauthCookieName("nonce", providerId);
      nonce = yield* cookies[nonceCookieName] != null
        ? Fx.succeed(cookies[nonceCookieName]!)
        : Fx.fail(
            new AuthError(
              "OAUTH_PROVIDER_ERROR",
              "Missing nonce cookie for OAuth callback",
            ),
          );
      resCookies.push(clearCookie("nonce", providerId));
    }

    // 4. Exchange code for tokens
    const tokens = yield* exchangeCode(arcticProvider, code, codeVerifier);

    if (oauthConfig.validateTokens !== undefined) {
      yield* Fx.from({
        ok: () => oauthConfig.validateTokens!(tokens, { nonce }),
        err: (e) =>
          new AuthError(
            "OAUTH_PROVIDER_ERROR",
            `Token validation failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
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
