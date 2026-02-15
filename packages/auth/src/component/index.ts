/**
 * Configuration and helpers for using Convex Auth on your Convex
 * backend.
 *
 * Use `new Auth(components.auth, config)` to configure authentication
 * and `Portal(auth)` to create portal admin exports.
 *
 * @module
 */

export {
  /**
   * The low-level factory function used internally by the `Auth` class.
   * Re-exported as `AuthFactory` to avoid naming conflicts with the
   * `Auth` class (the recommended public API). Prefer `new Auth(...)`.
   */
  Auth as AuthFactory,
  Tokens,
  Doc,
  SignInAction,
  SignOutAction,
} from "../server/implementation/index.js";
export { Auth, Portal, AuthCtx } from "../server/auth.js";
export type { AuthCtxConfig, UserDoc } from "../server/auth.js";
export type {
  ConvexAuthConfig,
  AuthProviderConfig,
  EmailConfig,
  EmailUserConfig,
  PhoneConfig,
  PhoneUserConfig,
  ConvexCredentialsConfig,
  GenericActionCtxWithAuthConfig,
  AuthProviderMaterializedConfig,
  ConvexAuthMaterializedConfig,
  ApiKeyConfig,
  KeyScope,
  ScopeChecker,
  KeyRecord,
  HttpKeyContext,
  CorsConfig,
} from "../server/types.js";
export type { GenericDoc } from "../server/types.js";
