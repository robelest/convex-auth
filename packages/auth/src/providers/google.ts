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
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  scopes?: string[];
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
