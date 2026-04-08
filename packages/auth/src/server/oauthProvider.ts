import type { OAuth2Tokens } from "arctic";

import type {
  OAuthMaterializedConfig,
  OAuthProfile,
  OAuthRuntimeClient,
  OAuthTokens,
} from "./types";

type LegacyOAuthProvider = {
  createAuthorizationURL: (...args: any[]) => URL;
  validateAuthorizationCode: (...args: any[]) => Promise<OAuth2Tokens>;
};

export interface OAuthProviderConfig {
  readonly id: string;
  readonly provider: OAuthRuntimeClient | LegacyOAuthProvider;
  readonly scopes: string[];
  readonly profile?: (tokens: OAuthTokens) => Promise<OAuthProfile>;
  readonly nonce?: boolean;
  readonly validateTokens?: (
    tokens: OAuthTokens,
    ctx: { nonce?: string },
  ) => Promise<void>;
  readonly accountLinking?: "verifiedEmail" | "none";
}

function normalizeTokens(tokens: OAuth2Tokens): OAuthTokens {
  const raw = tokens.data as Record<string, unknown>;
  const rawScopes = typeof raw.scope === "string" ? raw.scope : undefined;
  return {
    accessToken: typeof raw.access_token === "string" ? raw.access_token : undefined,
    refreshToken:
      typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    idToken: typeof raw.id_token === "string" ? raw.id_token : undefined,
    accessTokenExpiresAt:
      typeof tokens.accessTokenExpiresAt === "function"
        ? tokens.accessTokenExpiresAt()
        : typeof raw.expires_in === "number"
          ? new Date(Date.now() + raw.expires_in * 1000)
          : undefined,
    scopes: rawScopes
      ? rawScopes
          .split(/[,\s]+/)
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
      : undefined,
    raw: tokens.data,
  };
}

function adaptLegacyProvider(provider: LegacyOAuthProvider): OAuthRuntimeClient {
  const pkce = provider.createAuthorizationURL.length >= 3 ? "required" : "never";
  return {
    pkce,
    createAuthorizationURL({ state, codeVerifier, scopes, nonce }) {
      const url =
        pkce === "required"
          ? provider.createAuthorizationURL(state, codeVerifier, scopes)
          : provider.createAuthorizationURL(state, scopes);
      if (nonce !== undefined) {
        url.searchParams.set("nonce", nonce);
      }
      return url;
    },
    async validateAuthorizationCode({ code, codeVerifier }) {
      const tokens =
        pkce === "required"
          ? await provider.validateAuthorizationCode(code, codeVerifier)
          : await provider.validateAuthorizationCode(code);
      return normalizeTokens(tokens);
    },
  };
}

export function createOAuthProvider(
  config: OAuthProviderConfig,
): OAuthMaterializedConfig {
  if (
    !config.provider ||
    typeof config.provider.createAuthorizationURL !== "function" ||
    typeof config.provider.validateAuthorizationCode !== "function"
  ) {
    throw new Error(
      `OAuth provider \"${config.id}\" must expose createAuthorizationURL() and validateAuthorizationCode().`,
    );
  }

  return {
    id: config.id,
    type: "oauth",
    provider: "pkce" in config.provider ? config.provider : adaptLegacyProvider(config.provider),
    scopes: [...config.scopes],
    profile: config.profile,
    nonce: config.nonce,
    validateTokens: config.validateTokens,
    accountLinking: config.accountLinking,
  };
}
