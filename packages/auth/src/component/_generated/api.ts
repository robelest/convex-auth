/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as factor_device from "../factor/device.js";
import type * as factor_passkey from "../factor/passkey.js";
import type * as factor_totp from "../factor/totp.js";
import type * as functions from "../functions.js";
import type * as group from "../group.js";
import type * as group_invite from "../group/invite.js";
import type * as group_member from "../group/member.js";
import type * as http from "../http.js";
import type * as index from "../index.js";
import type * as model from "../model.js";
import type * as modules from "../modules.js";
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
import type * as rateLimit from "../rateLimit.js";
import type * as session from "../session.js";
import type * as sso_audit from "../sso/audit.js";
import type * as sso_connection from "../sso/connection.js";
import type * as sso_connection_domain from "../sso/connection/domain.js";
import type * as sso_connection_domain_verification from "../sso/connection/domain/verification.js";
import type * as sso_connection_scimConfig from "../sso/connection/scimConfig.js";
import type * as sso_connection_scimIdentity from "../sso/connection/scimIdentity.js";
import type * as sso_connection_secret from "../sso/connection/secret.js";
import type * as sso_webhook_delivery from "../sso/webhook/delivery.js";
import type * as sso_webhook_endpoint from "../sso/webhook/endpoint.js";
import type * as token_pkce from "../token/pkce.js";
import type * as token_refresh from "../token/refresh.js";
import type * as token_verification from "../token/verification.js";
import type * as user from "../user.js";
import type * as user_email from "../user/email.js";
import type * as user_key from "../user/key.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  account: typeof account;
  "factor/device": typeof factor_device;
  "factor/passkey": typeof factor_passkey;
  "factor/totp": typeof factor_totp;
  functions: typeof functions;
  group: typeof group;
  "group/invite": typeof group_invite;
  "group/member": typeof group_member;
  http: typeof http;
  index: typeof index;
  model: typeof model;
  modules: typeof modules;
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
  rateLimit: typeof rateLimit;
  session: typeof session;
  "sso/audit": typeof sso_audit;
  "sso/connection": typeof sso_connection;
  "sso/connection/domain": typeof sso_connection_domain;
  "sso/connection/domain/verification": typeof sso_connection_domain_verification;
  "sso/connection/scimConfig": typeof sso_connection_scimConfig;
  "sso/connection/scimIdentity": typeof sso_connection_scimIdentity;
  "sso/connection/secret": typeof sso_connection_secret;
  "sso/webhook/delivery": typeof sso_webhook_delivery;
  "sso/webhook/endpoint": typeof sso_webhook_endpoint;
  "token/pkce": typeof token_pkce;
  "token/refresh": typeof token_refresh;
  "token/verification": typeof token_verification;
  user: typeof user;
  "user/email": typeof user_email;
  "user/key": typeof user_key;
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
