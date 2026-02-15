/**
 * OAuth provider factory for wrapping Arctic provider instances.
 *
 * ```ts
 * import { Google, GitHub } from "arctic";
 * import { OAuth } from "@robelest/convex-auth/providers";
 *
 * OAuth(new Google(clientId, clientSecret, redirectURI), {
 *   scopes: ["openid", "profile", "email"],
 * })
 * ```
 *
 * @module
 */

import type { OAuth2Tokens } from "arctic";
import type { OAuthProfile } from "../server/types";

/**
 * Configuration for an OAuth provider.
 */
export interface OAuthConfig {
  /** OAuth scopes to request during authorization. */
  scopes?: string[];
  /**
   * Extract user profile from tokens.
   *
   * Required for non-OIDC providers (e.g. GitHub) that don't return an ID token.
   * For OIDC providers, defaults to decoding the ID token claims.
   */
  profile?: (tokens: OAuth2Tokens) => Promise<OAuthProfile>;
  /**
   * Override the provider ID derived from the class name.
   * Used for route matching (`/api/auth/signin/{id}`).
   */
  id?: string;
}

/** The internal tag for identifying OAuth provider configs. */
export const OAUTH_PROVIDER_TAG = "__convex_oauth" as const;

/**
 * An OAuth provider instance with config attached.
 *
 * Created by the `OAuth()` factory. The runtime detects these via the `_tag` field.
 */
export interface OAuthProviderInstance {
  readonly _tag: typeof OAUTH_PROVIDER_TAG;
  /** The provider ID (e.g. "google", "github"). */
  readonly id: string;
  /** The Arctic provider instance. */
  readonly provider: any;
  /** OAuth scopes. */
  readonly scopes: string[];
  /** Optional profile extraction callback. */
  readonly profile?: (tokens: OAuth2Tokens) => Promise<OAuthProfile>;
}

/**
 * Wrap an Arctic provider instance with scopes and profile config.
 *
 * The provider ID is derived from `provider.constructor.name.toLowerCase()`
 * unless overridden via `config.id`.
 *
 * @param provider - An Arctic provider instance (e.g. `new Google(...)`)
 * @param config - Optional scopes, profile callback, and ID override
 * @returns A tagged OAuth provider config for the `providers` array
 *
 * @example
 * ```ts
 * import { Google } from "arctic";
 * import { OAuth } from "@robelest/convex-auth/providers";
 *
 * OAuth(new Google(clientId, clientSecret, redirectURI), {
 *   scopes: ["openid", "profile", "email"],
 * })
 * ```
 */
export function OAuth(
  provider: any,
  config?: OAuthConfig,
): OAuthProviderInstance {
  if (
    !provider ||
    typeof provider.createAuthorizationURL !== "function" ||
    typeof provider.validateAuthorizationCode !== "function"
  ) {
    throw new Error(
      "OAuth() expects an Arctic provider instance with createAuthorizationURL and validateAuthorizationCode methods.",
    );
  }

  const id =
    config?.id ?? provider.constructor?.name?.toLowerCase() ?? "oauth";

  return {
    _tag: OAUTH_PROVIDER_TAG,
    id,
    provider,
    scopes: config?.scopes ?? [],
    profile: config?.profile,
  };
}

/**
 * Type guard to check if a provider config is an OAuth provider.
 */
export function isOAuthProvider(value: unknown): value is OAuthProviderInstance {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as any)._tag === OAUTH_PROVIDER_TAG
  );
}
