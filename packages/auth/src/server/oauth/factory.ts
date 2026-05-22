import type { OAuth2Tokens } from "arctic";

import type { OAuthMaterializedConfig, OAuthProfile, OAuthTokens } from "../types";

type OAuthRuntimeClient = {
  readonly pkce: "required" | "optional" | "never";
  createAuthorizationURL(args: {
    state: string;
    codeVerifier?: string;
    scopes: string[];
    nonce?: string;
    loginHint?: string;
  }): URL;
  validateAuthorizationCode(args: { code: string; codeVerifier?: string }): Promise<OAuthTokens>;
};

type ArcticPkceMode = OAuthRuntimeClient["pkce"];

type ArcticOAuthProviderWithoutPkce = {
  createAuthorizationURL(state: string, scopes: string[]): URL;
  validateAuthorizationCode(code: string): Promise<OAuth2Tokens>;
};

type ArcticOAuthProviderWithPkce = {
  createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL;
  validateAuthorizationCode(code: string, codeVerifier: string): Promise<OAuth2Tokens>;
};

type ArcticOAuthProviderFactory = () =>
  | ArcticOAuthProviderWithoutPkce
  | ArcticOAuthProviderWithPkce;

/**
 * Internal provider config used to materialize OAuth providers for the auth runtime.
 *
 * @internal
 */
export interface OAuthProviderConfig {
  readonly id: string;
  readonly provider: OAuthRuntimeClient;
  readonly scopes: string[];
  readonly profile?: (tokens: OAuthTokens) => Promise<OAuthProfile>;
  readonly nonce?: boolean;
  readonly validateTokens?: (tokens: OAuthTokens, ctx: { nonce?: string }) => Promise<void>;
  readonly accountLinking?: "verifiedEmail" | "none";
  readonly updateProfileOnLogin?: boolean;
}

function normalizeTokens(tokens: OAuth2Tokens): OAuthTokens {
  const raw = tokens.data as Record<string, unknown>;
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
          .split(/[,\s]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : undefined,
    raw: tokens.data,
  };
}

/**
 * Adapt an Arctic OAuth provider to Convex Auth's internal OAuth runtime contract.
 *
 * @internal
 */
export function createArcticOAuthClient(
  provider: ArcticOAuthProviderWithoutPkce | (() => ArcticOAuthProviderWithoutPkce),
  options?: { pkce?: Extract<ArcticPkceMode, "never"> },
): OAuthRuntimeClient;
export function createArcticOAuthClient(
  provider: ArcticOAuthProviderWithPkce | (() => ArcticOAuthProviderWithPkce),
  options?: { pkce?: Extract<ArcticPkceMode, "required" | "optional"> },
): OAuthRuntimeClient;
export function createArcticOAuthClient(
  provider:
    | ArcticOAuthProviderWithoutPkce
    | ArcticOAuthProviderWithPkce
    | ArcticOAuthProviderFactory,
  options?: { pkce?: ArcticPkceMode },
): OAuthRuntimeClient {
  const getProvider = () => (typeof provider === "function" ? provider() : provider);
  const pkce =
    options?.pkce ?? (getProvider().createAuthorizationURL.length >= 3 ? "required" : "never");
  return {
    pkce,
    createAuthorizationURL({ state, codeVerifier, scopes, nonce }) {
      const provider = getProvider();
      const url =
        pkce !== "never"
          ? (
              provider as {
                createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL;
              }
            ).createAuthorizationURL(state, codeVerifier!, scopes)
          : (
              provider as {
                createAuthorizationURL(state: string, scopes: string[]): URL;
              }
            ).createAuthorizationURL(state, scopes);
      if (nonce !== undefined) {
        url.searchParams.set("nonce", nonce);
      }
      return url;
    },
    async validateAuthorizationCode({ code, codeVerifier }) {
      const provider = getProvider();
      const tokens =
        pkce !== "never"
          ? await (
              provider as {
                validateAuthorizationCode(
                  code: string,
                  codeVerifier: string,
                ): Promise<OAuth2Tokens>;
              }
            ).validateAuthorizationCode(code, codeVerifier!)
          : await (
              provider as {
                validateAuthorizationCode(code: string): Promise<OAuth2Tokens>;
              }
            ).validateAuthorizationCode(code);
      return normalizeTokens(tokens);
    },
  };
}

/**
 * Materialize a validated OAuth provider definition for internal auth runtime use.
 *
 * @internal
 */
export function createOAuthProvider(config: OAuthProviderConfig): OAuthMaterializedConfig {
  if (
    !config.provider ||
    typeof config.provider.createAuthorizationURL !== "function" ||
    typeof config.provider.validateAuthorizationCode !== "function"
  ) {
    throw new Error(
      `OAuth provider "${config.id}" must expose createAuthorizationURL() and validateAuthorizationCode().`,
    );
  }

  return {
    id: config.id,
    type: "oauth",
    provider: config.provider,
    scopes: [...config.scopes],
    profile: config.profile,
    nonce: config.nonce,
    validateTokens: config.validateTokens,
    accountLinking: config.accountLinking,
    updateProfileOnLogin: config.updateProfileOnLogin,
  };
}
