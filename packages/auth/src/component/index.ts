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
} from "../server/implementation/index";
export type {
  Tokens,
  Doc,
  SignInAction,
  SignOutAction,
} from "../server/implementation/index";
export { Auth, Portal, AuthCtx } from "../server/auth";
export type { AuthCtxConfig, InferAuth, UserDoc } from "../server/auth";
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
  DeviceProviderConfig,
} from "../server/types";
export type { GenericDoc } from "../server/types";
