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
  Auth as AuthFactory,
  Tokens,
  Doc,
  SignInAction,
  SignOutAction,
} from "../server/implementation/index.js";
export { Auth, Portal } from "../server/convex-auth.js";
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
} from "../server/types.js";
export type { GenericDoc } from "../server/convex_types.js";
