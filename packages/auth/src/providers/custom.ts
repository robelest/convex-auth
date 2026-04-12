/**
 * Custom OAuth provider.
 *
 * Use this as an escape hatch for OAuth providers that do not have a first-
 * party wrapper yet.
 *
 * @module
 */

import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";

import { envOptionalString, readConfigSync } from "../server/env";
import { createOAuthProvider } from "../server/oauth/factory";
import type {
  OAuthProfile,
  OAuthRuntimeClient,
  OAuthTokens,
} from "../server/types";

type ScopeSeparator = " " | ",";
type PkceMode = "required" | "optional" | "never";
type TokenAuthMethod = "basic" | "body" | "none";

/** Configuration for the custom provider authorization URL. */
export interface CustomOAuthAuthorizationConfig {
  url: string;
  pkce?: PkceMode;
  clientIdParam?: string;
  scopeParam?: string;
  scopeSeparator?: ScopeSeparator;
  extraParams?: Record<string, string>;
}

/** Configuration for the custom provider token exchange request. */
export interface CustomOAuthTokenConfig {
  url: string;
  authMethod?: TokenAuthMethod;
  clientIdParam?: string;
  clientSecretParam?: string;
  codeVerifierParam?: string;
  scopeParam?: string;
  scopeSeparator?: ScopeSeparator;
  includeRedirectUri?: boolean;
  includeScopes?: boolean;
  extraParams?: Record<string, string>;
}

/** Configuration for the {@link custom} provider. */
export interface CustomOAuthConfig {
  id: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri?: string;
  scopes?: string[];
  accountLinking?: "verifiedEmail" | "none";
  nonce?: boolean;
  authorization: CustomOAuthAuthorizationConfig;
  token: CustomOAuthTokenConfig;
  profile?: (tokens: OAuthTokens) => Promise<OAuthProfile>;
  validateTokens?: (
    tokens: OAuthTokens,
    ctx: { nonce?: string },
  ) => Promise<void>;
}

function defaultRedirectUri(providerId: string) {
  const rootUrl =
    readConfigSync(envOptionalString("CUSTOM_AUTH_SITE_URL")) ??
    readConfigSync(envOptionalString("CONVEX_SITE_URL"));
  if (!rootUrl) {
    throw new Error(
      `Missing CONVEX_SITE_URL while configuring ${providerId} OAuth provider. ` +
        "Set CONVEX_SITE_URL or pass redirectUri explicitly.",
    );
  }
  return `${rootUrl}/api/auth/callback/${providerId}`;
}

function joinScopes(scopes: string[], separator: ScopeSeparator = " ") {
  return scopes.join(separator);
}

function createCodeChallenge(codeVerifier: string) {
  return encodeBase64urlNoPadding(sha256(new TextEncoder().encode(codeVerifier)));
}

function createRuntimeClient(config: CustomOAuthConfig): OAuthRuntimeClient {
  const redirectUri = config.redirectUri ?? defaultRedirectUri(config.id);
  const authorization = config.authorization;
  const token = config.token;
  const pkce = authorization.pkce ?? "required";
  const scopes = [...(config.scopes ?? [])];

  return {
    pkce,
    createAuthorizationURL({ state, codeVerifier, scopes: requestedScopes, nonce }) {
      const url = new URL(authorization.url);
      const nextScopes = requestedScopes.length > 0 ? requestedScopes : scopes;
      url.searchParams.set("response_type", "code");
      url.searchParams.set(authorization.clientIdParam ?? "client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      if (nextScopes.length > 0) {
        url.searchParams.set(
          authorization.scopeParam ?? "scope",
          joinScopes(nextScopes, authorization.scopeSeparator),
        );
      }
      if (codeVerifier !== undefined && pkce !== "never") {
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
      }
      if (nonce !== undefined) {
        url.searchParams.set("nonce", nonce);
      }
      for (const [key, value] of Object.entries(authorization.extraParams ?? {})) {
        url.searchParams.set(key, value);
      }
      return url;
    },
    async validateAuthorizationCode({ code, codeVerifier }) {
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");
      body.set("code", code);
      if (token.includeRedirectUri ?? true) {
        body.set("redirect_uri", redirectUri);
      }
      if (pkce !== "never" && codeVerifier !== undefined) {
        body.set(token.codeVerifierParam ?? "code_verifier", codeVerifier);
      }
      if (token.includeScopes === true && scopes.length > 0) {
        body.set(
          token.scopeParam ?? "scope",
          joinScopes(scopes, token.scopeSeparator ?? authorization.scopeSeparator),
        );
      }
      if (token.authMethod !== "basic") {
        body.set(token.clientIdParam ?? "client_id", config.clientId);
      }
      if (
        token.authMethod !== "basic" &&
        token.authMethod !== "none" &&
        config.clientSecret
      ) {
        body.set(
          token.clientSecretParam ?? "client_secret",
          config.clientSecret,
        );
      }
      for (const [key, value] of Object.entries(token.extraParams ?? {})) {
        body.set(key, value);
      }

      const headers = new Headers({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      if (token.authMethod === "basic") {
        if (!config.clientSecret) {
          throw new Error(
            `OAuth provider "${config.id}" requires clientSecret for token.authMethod="basic".`,
          );
        }
        const credentials = btoa(`${config.clientId}:${config.clientSecret}`);
        headers.set("Authorization", `Basic ${credentials}`);
      }

      const response = await fetch(token.url, {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) {
        throw new Error(`OAuth token exchange failed: ${response.status}`);
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const rawScopes = typeof raw.scope === "string" ? raw.scope : undefined;
      const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
      return {
        accessToken:
          typeof raw.access_token === "string" ? raw.access_token : undefined,
        refreshToken:
          typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
        idToken: typeof raw.id_token === "string" ? raw.id_token : undefined,
        accessTokenExpiresAt:
          expiresIn !== undefined ? new Date(Date.now() + expiresIn * 1000) : undefined,
        scopes: rawScopes
          ? rawScopes
              .split(/[\s,]+/)
              .map((scope) => scope.trim())
              .filter((scope) => scope.length > 0)
          : undefined,
        raw,
      };
    },
  };
}

/**
 * Create a custom OAuth provider.
 *
 * @param config - OAuth endpoints, credentials, and profile callbacks.
 * @returns A configured OAuth provider for `createAuth`.
 */
export function custom(config: CustomOAuthConfig) {
  return createOAuthProvider({
    id: config.id,
    provider: createRuntimeClient(config),
    scopes: config.scopes ?? [],
    profile: config.profile,
    nonce: config.nonce,
    validateTokens: config.validateTokens,
    accountLinking: config.accountLinking,
  });
}
