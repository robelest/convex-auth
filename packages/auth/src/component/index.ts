/**
 * Configuration and helpers for using Convex Auth on your Convex
 * backend.
 *
 * Use `createAuth(components.auth, config)` to configure authentication.
 *
 * @module
 */

export { createAuth } from "../server/auth";
export type {
  AuthApi,
  AuthContext,
  AuthContextConfig,
  AuthConfig,
  InferAuth,
  OptionalAuthContext,
  UserDoc,
} from "../server/auth";
export type {
  HttpAuthContext,
  HttpAuthContextConfig,
  OptionalHttpAuthContext,
} from "../server/http";
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
  GroupConnectionPolicy,
  GroupConnectionPolicyPatch,
  HttpKeyContext,
  CorsConfig,
  DeviceProviderConfig,
} from "../server/types";
export type { GenericDoc } from "../server/types";
