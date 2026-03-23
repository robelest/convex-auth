/**
 * Enterprise SSO provider (OIDC + SAML + SCIM).
 *
 * Adding `new SSO()` to your providers list enables enterprise SSO
 * sign-in flows and registers the OIDC, SAML, and SCIM runtime HTTP
 * routes. It also makes `auth.sso.*` available on the auth
 * object returned by `createAuth`.
 *
 * ```ts
 * import { SSO } from "@robelest/convex-auth/providers";
 *
 * const auth = createAuth(components.auth, {
 *   providers: [new SSO(), new Password()],
 * });
 *
 * // auth.sso is now available
 * await auth.sso.admin.oidc.configure(ctx, { enterpriseId, clientId, ... });
 * ```
 *
 * Without `new SSO()` in the providers list, `auth.sso` is not
 * present on the returned object and accessing it is a TypeScript error.
 *
 * @module
 */

import type { SSOProviderConfig } from "../server/types";

/**
 * Enterprise SSO provider.
 *
 * Zero-configuration — sensible defaults are applied for all enterprise
 * protocols (OIDC, SAML, SCIM). Per-tenant configuration is done at
 * runtime via `auth.sso.*` helpers.
 *
 * @example
 * ```ts
 * import { createAuth } from "@robelest/convex-auth/component";
 * import { SSO, Password } from "@robelest/convex-auth/providers";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuth(components.auth, {
 *   providers: [new SSO(), new Password()],
 * });
 * ```
 */
export class SSO {
  readonly id = "enterprise-sso";
  readonly type = "sso" as const;

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): SSOProviderConfig {
    return { id: this.id, type: "sso" };
  }
}
