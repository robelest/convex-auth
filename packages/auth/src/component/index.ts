/**
 * Configuration and helpers for using Convex Auth on your Convex
 * backend.
 *
 * Use `createAuth(components.auth, config)` to configure authentication.
 *
 * @module
 */

export { AuthCtx, createAuth } from "../server/auth";
export type {
  AuthApi,
  AuthConfig,
  AuthCtxConfig,
  AuthResolvedContext,
  InferAuth,
  UserDoc,
} from "../server/auth";
export type {
  ConvexAuthConfig,
  AuthProviderConfig,
  EmailConfig,
  EmailUserConfig,
  PhoneConfig,
  PhoneUserConfig,
  ConvexCredentialsConfig,
  KeyScope,
  ScopeChecker,
  KeyRecord,
  EnterprisePolicy,
  EnterprisePolicyPatch,
  HttpKeyContext,
  CorsConfig,
  DeviceProviderConfig,
} from "../server/types";
export type { GenericDoc } from "../server/types";
