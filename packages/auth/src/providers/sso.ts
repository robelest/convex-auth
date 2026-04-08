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
 * @returns A provider that enables the `auth.group.sso.*` server helpers and
 * registers the runtime SSO routes.
 *
 * @example
 * ```ts
 * import { sso } from "@robelest/convex-auth/providers";
 *
 * sso()
 * ```
 */
export function sso(): SSOProviderConfig {
  return { id: "sso", type: "sso" };
}
