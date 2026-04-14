/**
 * Apple OAuth provider.
 *
 * ```ts
 * import { apple } from "@robelest/convex-auth/providers/apple";
 *
 * apple({
 *   clientId: process.env.AUTH_APPLE_ID!,
 *   teamId: process.env.AUTH_APPLE_TEAM_ID!,
 *   keyId: process.env.AUTH_APPLE_KEY_ID!,
 *   privateKey: process.env.AUTH_APPLE_PRIVATE_KEY!,
 * })
 * ```
 *
 * @module
 */

import { Apple as ArcticApple } from "arctic";

import { envOptionalString, readConfigSync } from "../server/env";
import {
  createArcticOAuthClient,
  createOAuthProvider,
} from "../server/oauth/factory";

const DEFAULT_SCOPES = ["name", "email"];

/** Configuration for the {@link apple} provider. */
export interface AppleConfig {
  /** Services ID or app bundle identifier registered with Sign in with Apple. */
  clientId: string;
  /** Apple Developer team identifier used to sign client secrets. */
  teamId: string;
  /** Apple private key identifier. */
  keyId: string;
  /** Apple private key PEM contents or bytes. */
  privateKey: string | Uint8Array;
  /** Optional callback URL override. Defaults to `CUSTOM_AUTH_SITE_URL` or `CONVEX_SITE_URL` plus `/api/auth/callback/apple`. */
  redirectUri?: string;
  /** Optional OAuth scopes. Defaults to `name email`. */
  scopes?: string[];
  /** Account-linking strategy for existing users with matching email addresses. */
  accountLinking?: "verifiedEmail" | "none";
}

/**
 * Create an Apple OAuth provider.
 *
 * @param config - Apple Sign In client settings and signing key material.
 * @returns A configured Apple OAuth provider for `createAuth`.
 * @throws {Error} When no callback URL can be derived and `redirectUri` is omitted.
 *
 * @example
 * ```ts
 * import { apple } from "@robelest/convex-auth/providers/apple";
 *
 * apple({
 *   clientId: process.env.AUTH_APPLE_ID!,
 *   teamId: process.env.AUTH_APPLE_TEAM_ID!,
 *   keyId: process.env.AUTH_APPLE_KEY_ID!,
 *   privateKey: process.env.AUTH_APPLE_PRIVATE_KEY!,
 * })
 * ```
 */
export function apple(config: AppleConfig) {
  return createOAuthProvider({
    id: "apple",
    provider: createArcticOAuthClient(
      new ArcticApple(
        config.clientId,
        config.teamId,
        config.keyId,
        typeof config.privateKey === "string"
          ? new TextEncoder().encode(config.privateKey)
          : config.privateKey,
        config.redirectUri ?? defaultRedirectUri("apple"),
      ),
      { pkce: "never" },
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
