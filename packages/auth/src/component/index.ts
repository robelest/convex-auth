/**
 * Configuration and helpers for using Convex Auth on your Convex
 * backend.
 *
 * Call {@link Auth} to configure your authentication methods
 * and use the helpers it returns.
 *
 * @module
 */

export {
  Auth,
  Tokens,
  Doc,
  SignInAction,
  SignOutAction,
} from "../server/implementation/index.js";
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
} from "../server/types.js";
export type { GenericDoc } from "../server/convex_types.js";
