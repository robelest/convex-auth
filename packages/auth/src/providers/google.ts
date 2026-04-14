/**
 * Google OAuth provider.
 *
 * ```ts
 * import { google } from "@robelest/convex-auth/providers/google";
 *
 * google({
 *   clientId: process.env.AUTH_GOOGLE_ID!,
 *   clientSecret: process.env.AUTH_GOOGLE_SECRET!,
 * })
 * ```
 *
 * @module
 */

import { Google as ArcticGoogle } from "arctic";

import { envOptionalString, readConfigSync } from "../server/env";
import { createArcticOAuthClient, createOAuthProvider } from "../server/oauth/factory";

const DEFAULT_SCOPES = ["openid", "profile", "email"];

/** Configuration for the {@link google} provider. */
export interface GoogleConfig {
  /** OAuth client ID from the Google Cloud console. */
  clientId: string;
  /** OAuth client secret from the Google Cloud console. */
  clientSecret: string;
  /** Optional callback URL override. Defaults to `CUSTOM_AUTH_SITE_URL` or `CONVEX_SITE_URL` plus `/api/auth/callback/google`. */
  redirectUri?: string;
  /** Optional OAuth scopes. Defaults to `openid profile email`. */
  scopes?: string[];
  /** Account-linking strategy for existing users with matching email addresses. */
  accountLinking?: "verifiedEmail" | "none";
}

/**
 * Create a Google OAuth provider.
 *
 * Uses the Google OpenID Connect flow and requests `openid profile email` by
 * default.
 *
 * @param config - Google OAuth client settings.
 * @returns A configured Google OAuth provider for `createAuth`.
 * @throws {Error} When no callback URL can be derived and `redirectUri` is omitted.
 *
 * @example
 * ```ts
 * import { google } from "@robelest/convex-auth/providers/google";
 *
 * google({
 *   clientId: process.env.AUTH_GOOGLE_ID!,
 *   clientSecret: process.env.AUTH_GOOGLE_SECRET!,
 * })
 * ```
 */
export function google(config: GoogleConfig) {
  return createOAuthProvider({
    id: "google",
    provider: createArcticOAuthClient(
      new ArcticGoogle(
        config.clientId,
        config.clientSecret,
        config.redirectUri ?? defaultRedirectUri("google"),
      ),
      { pkce: "required" },
    ),
    scopes: config.scopes ?? DEFAULT_SCOPES,
    accountLinking: config.accountLinking,
  });
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
