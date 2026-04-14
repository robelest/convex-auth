/**
 * Group SSO provider (OIDC + SAML + SCIM).
 *
 * Adding `sso()` to your providers list enables group SSO
 * sign-in flows and registers the OIDC, SAML, and SCIM runtime HTTP
 * routes. It also makes `auth.group.sso.*` available on the auth
 * object returned by `createAuth`.
 *
 * @module
 */

import type { SSOProviderConfig } from "../server/types";

/**
 * Create the group SSO provider.
 *
 * @param options - Optional SSO provider settings.
 * @param options.redirectURI - Override the callback URI used for provider
 *   initiated sign-in flows.
 * @returns A provider that enables the `auth.group.sso.*` server helpers and
 * registers the runtime SSO routes.
 *
 * @example
 * ```ts
 * import { sso } from "@robelest/convex-auth/providers";
 *
 * sso()
 * ```
 *
 * @example
 * ```ts
 * sso({ redirectURI: "https://app.example.com/auth/sso/callback" })
 * ```
 */
export function sso(options?: { redirectURI?: string }): SSOProviderConfig {
  return { id: "sso", type: "sso", redirectURI: options?.redirectURI };
}
