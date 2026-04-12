/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions from "../functions.js";
import type * as index from "../index.js";
import type * as model from "../model.js";
import type * as modules from "../modules.js";
import type * as public_ from "../public.js";
import type * as public_factors_devices from "../public/factors/devices.js";
import type * as public_factors_passkeys from "../public/factors/passkeys.js";
import type * as public_factors_totp from "../public/factors/totp.js";
import type * as public_groups_core from "../public/groups/core.js";
import type * as public_groups_invites from "../public/groups/invites.js";
import type * as public_groups_members from "../public/groups/members.js";
import type * as public_identity_accounts from "../public/identity/accounts.js";
import type * as public_identity_codes from "../public/identity/codes.js";
import type * as public_identity_sessions from "../public/identity/sessions.js";
import type * as public_identity_tokens from "../public/identity/tokens.js";
import type * as public_identity_users from "../public/identity/users.js";
import type * as public_identity_verifiers from "../public/identity/verifiers.js";
import type * as public_security_keys from "../public/security/keys.js";
import type * as public_security_limits from "../public/security/limits.js";
import type * as public_sso_audit from "../public/sso/audit.js";
import type * as public_sso_core from "../public/sso/core.js";
import type * as public_sso_domains from "../public/sso/domains.js";
import type * as public_sso_scim from "../public/sso/scim.js";
import type * as public_sso_secrets from "../public/sso/secrets.js";
import type * as public_sso_webhooks from "../public/sso/webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  functions: typeof functions;
  index: typeof index;
  model: typeof model;
  modules: typeof modules;
  public: typeof public_;
  "public/factors/devices": typeof public_factors_devices;
  "public/factors/passkeys": typeof public_factors_passkeys;
  "public/factors/totp": typeof public_factors_totp;
  "public/groups/core": typeof public_groups_core;
  "public/groups/invites": typeof public_groups_invites;
  "public/groups/members": typeof public_groups_members;
  "public/identity/accounts": typeof public_identity_accounts;
  "public/identity/codes": typeof public_identity_codes;
  "public/identity/sessions": typeof public_identity_sessions;
  "public/identity/tokens": typeof public_identity_tokens;
  "public/identity/users": typeof public_identity_users;
  "public/identity/verifiers": typeof public_identity_verifiers;
  "public/security/keys": typeof public_security_keys;
  "public/security/limits": typeof public_security_limits;
  "public/sso/audit": typeof public_sso_audit;
  "public/sso/core": typeof public_sso_core;
  "public/sso/domains": typeof public_sso_domains;
  "public/sso/scim": typeof public_sso_scim;
  "public/sso/secrets": typeof public_sso_secrets;
  "public/sso/webhooks": typeof public_sso_webhooks;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
