/**
 * Server-side entrypoint for `@robelest/convex-auth/server`.
 *
 * Re-exports the public helpers, types, and HTTP integration utilities used to
 * configure Convex Auth on the backend.
 *
 * @module
 */

import "./identity/convex";

export { createAuth } from "./auth";
export type {
  AuthApi,
  AuthApiBase,
  AuthContext,
  AuthContextConfig,
  AuthConfig,
  AuthExtendValidators,
  AuthValidators,
  ConvexAuthResult,
  InferAuth,
  InferClientApi,
  OptionalAuthContext,
  UserDoc,
} from "./auth";
export { buildAuthValidators } from "./validators";
export type {
  Group,
  Membership,
  Viewer,
} from "./validators";
export type { Doc, GenericDoc, AuthDataModel } from "./types";
export {
  vGroupDoc,
  vGroupInviteDoc,
  vGroupMemberDoc,
  vPaginated,
  vUserDoc,
  vUserEmailDoc,
} from "../component/model";
export type { HttpAuthContext, HttpAuthContextConfig, OptionalHttpAuthContext } from "./http";
export type {
  GroupSsoAccessInput,
  GroupSsoAccessHandler,
  GroupSsoAccessPermissions,
  GroupSsoPermission,
  GroupSsoResolvedAccessHandler,
  CreateAuthGroupSsoOptions,
} from "./mounts";
export { createAuthGroupSso, scim, sso } from "./mounts";
export type {
  AuthCookie,
  AuthCookieConfig,
  AuthCookies,
  RefreshResult,
  ServerOptions,
} from "./prefetch";
export {
  authCookieNames,
  parseAuthCookies,
  serializeAuthCookies,
  server,
  shouldProxyAuthAction,
  structuredAuthCookies,
} from "./prefetch";
export { wellKnown } from "./wellknown";
export type { WellKnownEndpoint, WellKnownOptions, WellKnownResponse } from "./wellknown";
export type {
  AfterCtx,
  AuthCallbackContext,
  AuthCallbackProfile,
  AuthCallbacks,
  AuthEvent,
  BeforeCtx,
  BeforeEvent,
  BeforeResult,
} from "./types";
