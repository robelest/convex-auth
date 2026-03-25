import {
  AnyDataModel,
  DataModelFromSchemaDefinition,
  DocumentByName,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
  TableNamesInDataModel,
} from "convex/server";
import type { Infer } from "convex/values";
import { GenericId, Value } from "convex/values";

import {
  vApiKeyDoc,
  vAuthVerifierDoc,
  vDeviceCodeDoc,
  vPasskeyDoc,
  vTotpFactorDoc,
  vUserDoc,
} from "../component/model";
import schema from "../component/schema";
import { CredentialsUserConfig } from "../providers/credentials";

// ============================================================================
// Utility types
// ============================================================================

/** A value that is either `T` or a `PromiseLike<T>`. */
export type Awaitable<T> = T | PromiseLike<T>;

export type AuthRoleDefinition = {
  id?: string;
  label?: string;
  grants: string[];
};

export type AuthAuthorizationConfig = {
  roles: Record<string, AuthRoleDefinition>;
};

export type AuthRoleId<
  TAuthorization extends AuthAuthorizationConfig | undefined,
> = TAuthorization extends { roles: infer TRoles extends Record<string, any> }
  ? keyof TRoles & string
  : string;

export type AuthGrant<
  TAuthorization extends AuthAuthorizationConfig | undefined,
> = TAuthorization extends {
  roles: infer TRoles extends Record<string, { grants: readonly any[] }>;
}
  ? TRoles[keyof TRoles]["grants"][number] & string
  : string;

/**
 * The config for the Convex Auth library, passed to `createAuth`.
 */
export type ConvexAuthConfig = {
  /**
   * A list of authentication provider configs.
   *
   * You can import existing configs from
   * `@robelest/convex-auth/providers/<provider-name>`
   */
  providers: AuthProviderConfig[];
  /**
   * Auth component reference from `components.auth`.
   *
   * Core auth storage operations are executed through
   * the component API boundary.
   */
  component: AuthComponentApi;
  /**
   * Session configuration.
   */
  session?: {
    /**
     * How long can a user session last without the user reauthenticating.
     *
     * Defaults to 30 days.
     */
    totalDurationMs?: number;
    /**
     * How long can a user session last without the user being active.
     *
     * Defaults to 30 days.
     */
    inactiveDurationMs?: number;
  };
  /**
   * JWT configuration.
   */
  jwt?: {
    /**
     * How long is the JWT valid for after it is signed initially.
     *
     * Defaults to 1 hour.
     */
    durationMs?: number;
  };
  /**
   * Sign-in configuration.
   */
  signIn?: {
    /**
     * How many times can the user fail to provide the correct credentials
     * (password, OTP) per hour.
     *
     * Defaults to 10 times per hour (that is 10 failed attempts, and then
     * allow another one every 6 minutes).
     */
    maxFailedAttemptsPerHour?: number;
  };
  /**
   * Lifecycle callbacks for customizing sign-in behavior.
   *
   * Use `redirect` to control post-OAuth redirect URLs, and
   * `createOrUpdateUser` or `afterUserCreatedOrUpdated` to
   * customize account linking and user document creation.
   */
  callbacks?: {
    /**
     * Control which URLs are allowed as a destination after OAuth sign-in
     * and for magic links:
     *
     * ```ts
     * import { createAuth } from "@robelest/convex-auth/component";
     * import { components } from "./_generated/api";
     *
     * const auth = createAuth(components.auth, {
     *   providers: [google],
     *   callbacks: {
     *     async redirect({ redirectTo }) {
     *       // Check that redirectTo is valid
     *       // and return the relative or absolute URL
     *       // to redirect to.
     *     },
     *   },
     * });
     * ```
     *
     * Convex Auth performs redirect only during OAuth sign-in. By default,
     * it redirects back to the URL specified via the `SITE_URL` environment
     * variable. Similarly magic links link to `SITE_URL`.
     *
     * You can customize that behavior by providing a `redirectTo` param
     * to the `signIn` function:
     *
     * ```ts
     * signIn("google", { redirectTo: "/dashboard" })
     * ```
     *
     * You can even redirect to a different site.
     *
     * This callback, if specified, is then called with the provided
     * `redirectTo` param. Otherwise, only query params, relative paths
     * and URLs starting with `SITE_URL` are allowed.
     */
    redirect?: (params: {
      /**
       * The param value passed to the `signIn` function.
       */
      redirectTo: string;
    }) => Promise<string>;
    /**
     * Completely control account linking via this callback.
     *
     * This callback is called during the sign-in process,
     * before account creation and token generation.
     * If specified, this callback is responsible for creating
     * or updating the user document.
     *
     * For "credentials" providers, the callback is only called
     * when `createAccount` is called.
     */
    createOrUpdateUser?: (
      ctx: GenericMutationCtx<AnyDataModel>,
      args: {
        /**
         * If this is a sign-in to an existing account,
         * this is the existing user ID linked to that account.
         */
        existingUserId: GenericId<"User"> | null;
        /**
         * The provider type or "verification" if this callback is called
         * after an email or phone token verification.
         */
        type: "oauth" | "credentials" | "email" | "phone" | "verification";
        /**
         * The provider used for the sign-in, or the provider
         * tied to the account which is having the email or phone verified.
         */
        provider: AuthProviderMaterializedConfig;
        /**
         * - The profile returned by the OAuth provider's `profile` method.
         * - The profile passed to `createAccount` from a ConvexCredentials
         * config.
         * - The email address to which an email will be sent.
         * - The phone number to which a text will be sent.
         */
        profile: Record<string, unknown> & {
          email?: string;
          phone?: string;
          emailVerified?: boolean;
          phoneVerified?: boolean;
        };
        /**
         * The `shouldLink` argument passed to `createAccount`.
         */
        shouldLink?: boolean;
      },
    ) => Promise<GenericId<"User">>;
    /**
     * Perform additional writes after a user is created.
     *
     * This callback is called during the sign-in process,
     * after the user is created or updated,
     * before account creation and token generation.
     *
     * **This callback is only called if `createOrUpdateUser`
     * is not specified.** If `createOrUpdateUser` is specified,
     * you can perform any additional writes in that callback.
     *
     * For "credentials" providers, the callback is only called
     * when `createAccount` is called.
     */
    afterUserCreatedOrUpdated?: (
      ctx: GenericMutationCtx<AnyDataModel>,
      args: {
        /**
         * The ID of the user that is being signed in.
         */
        userId: GenericId<"User">;
        /**
         * If this is a sign-in to an existing account,
         * this is the existing user ID linked to that account.
         */
        existingUserId: GenericId<"User"> | null;
        /**
         * The provider type or "verification" if this callback is called
         * after an email or phone token verification.
         */
        type: "oauth" | "credentials" | "email" | "phone" | "verification";
        /**
         * The provider used for the sign-in, or the provider
         * tied to the account which is having the email or phone verified.
         */
        provider: AuthProviderMaterializedConfig;
        /**
         * - The profile returned by the OAuth provider's `profile` method.
         * - The profile passed to `createAccount` from a ConvexCredentials
         * config.
         * - The email address to which an email will be sent.
         * - The phone number to which a text will be sent.
         */
        profile: Record<string, unknown> & {
          email?: string;
          phone?: string;
          emailVerified?: boolean;
          phoneVerified?: boolean;
        };
        /**
         * The `shouldLink` argument passed to `createAccount`.
         */
        shouldLink?: boolean;
      },
    ) => Promise<void>;
  };
  /**
   * Application-defined role and grant model used by membership access checks.
   */
  authorization?: {
    roles: Record<
      string,
      {
        label?: string;
        grants: string[];
      }
    >;
  };
};

/**
 * Union of all supported auth provider config types.
 *
 * Includes Arctic-based OAuth providers (via the `OAuth()` factory),
 * plus library-native providers: credentials, email, phone, passkey
 * (WebAuthn), and TOTP (2FA). Each can be passed as a config object
 * or a factory function.
 */
export type AuthProviderConfig =
  | import("../providers/oauth").OAuthProviderInstance
  | import("../providers/password").Password
  | import("../providers/passkey").Passkey
  | import("../providers/totp").Totp
  | import("../providers/anonymous").Anonymous
  | import("../providers/device").Device
  | import("../providers/sso").SSO
  | import("../providers/email").Email
  | import("../providers/phone").Phone
  | OAuthMaterializedConfig
  | ConvexCredentialsConfig
  | ((...args: any) => ConvexCredentialsConfig)
  | EmailConfig
  | ((...args: any) => EmailConfig)
  | PhoneConfig
  | ((...args: any) => PhoneConfig)
  | PasskeyProviderConfig
  | ((...args: any) => PasskeyProviderConfig)
  | TotpProviderConfig
  | ((...args: any) => TotpProviderConfig)
  | DeviceProviderConfig
  | ((...args: any) => DeviceProviderConfig)
  | SSOProviderConfig;

/**
 * Minimal config stored for the SSO provider at runtime.
 * No options — enterprise configuration is entirely per-tenant runtime state.
 */
export interface SSOProviderConfig {
  id: string;
  type: "sso";
}

export type EnterpriseAccountLinkingPolicy = "verifiedEmail" | "none";

export type EnterpriseScimReuseUserPolicy = "externalId" | "none";

export type EnterpriseJitProvisioningMode =
  | "off"
  | "createUser"
  | "createUserAndMembership";

export type EnterpriseDeprovisionMode = "soft" | "hard";

export interface EnterprisePolicy {
  version: 1;
  identity: {
    accountLinking: {
      oidc: EnterpriseAccountLinkingPolicy;
      saml: EnterpriseAccountLinkingPolicy;
    };
  };
  provisioning: {
    scimReuse: {
      user: EnterpriseScimReuseUserPolicy;
    };
    jit: {
      mode: EnterpriseJitProvisioningMode;
      defaultRoleIds: string[];
    };
    deprovision: {
      mode: EnterpriseDeprovisionMode;
    };
  };
  extend?: Record<string, unknown>;
}

export interface EnterprisePolicyPatch {
  identity?: {
    accountLinking?: {
      oidc?: EnterpriseAccountLinkingPolicy;
      saml?: EnterpriseAccountLinkingPolicy;
    };
  };
  provisioning?: {
    scimReuse?: {
      user?: EnterpriseScimReuseUserPolicy;
    };
    jit?: {
      mode?: EnterpriseJitProvisioningMode;
      defaultRoleIds?: string[];
    };
    deprovision?: {
      mode?: EnterpriseDeprovisionMode;
    };
  };
  extend?: Record<string, unknown>;
}

/**
 * Email provider config for magic link / OTP sign-in.
 */
export interface EmailConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> {
  /** Provider identifier (e.g. `"email"`, `"resend"`). */
  id: string;
  /** Discriminant for provider type routing. */
  type: "email";
  /** Display name for this provider. */
  name?: string;
  /** Sender address (e.g. `"My App <noreply@example.com>"`). */
  from?: string;
  /** Token expiration in seconds. Defaults to 86 400 (24 hours). */
  maxAge?: number;
  /**
   * Send the verification token to the user.
   *
   * Accepts an optional Convex action context as the second argument,
   * enabling use with Convex components like `@convex-dev/resend`.
   */
  sendVerificationRequest: (
    params: {
      identifier: string;
      url: string;
      expires: Date;
      provider: EmailConfig;
      token: string;
      request: Request;
    },
    ctx?: GenericActionCtx<AnyDataModel>,
  ) => Awaitable<void>;
  /**
   * Override to generate a custom verification token.
   * Tokens shorter than 24 characters are treated as OTPs and
   * require the original email to be re-submitted for verification.
   */
  generateVerificationToken?: () => Awaitable<string>;
  /**
   * Normalize the email address before storage / lookup.
   * Defaults to lowercasing and trimming whitespace.
   */
  normalizeIdentifier?: (identifier: string) => string;
  /**
   * Before the token is verified, check other
   * provided parameters.
   *
   * Used to make sure that OTPs are accompanied
   * with the correct email address.
   */
  authorize?: (
    /**
     * The values passed to the `signIn` function.
     */
    params: Record<string, Value | undefined>,
    account: GenericDoc<DataModel, "Account">,
  ) => Promise<void>;
  /** Raw user options before merging with defaults. */
  options: EmailUserConfig<DataModel>;
}

/**
 * Configurable options for an email provider config.
 */
export type EmailUserConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> = Omit<Partial<EmailConfig<DataModel>>, "options" | "type">;

/**
 * Same as email provider config, but verifies
 * phone number instead of the email address.
 */
export interface PhoneConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> {
  id: string;
  type: "phone";
  /**
   * Token expiration in seconds.
   */
  maxAge: number;
  /**
   * Send the phone number verification request.
   */
  sendVerificationRequest: (
    params: {
      identifier: string;
      url: string;
      expires: Date;
      provider: PhoneConfig;
      token: string;
    },
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => Promise<void>;
  /**
   * Defaults to `process.env.AUTH_<PROVIDER_ID>_KEY`.
   */
  apiKey?: string;
  /**
   * Override this to generate a custom token.
   * Note that the tokens are assumed to be cryptographically secure.
   * Any tokens shorter than 24 characters are assumed to not
   * be secure enough on their own, and require providing
   * the original `phone` used in the initial `signIn` call.
   * @returns
   */
  generateVerificationToken?: () => Promise<string>;
  /**
   * Normalize the phone number.
   * @param identifier Passed as `phone` in params of `signIn`.
   * @returns The phone number used in `sendVerificationRequest`.
   */
  normalizeIdentifier?: (identifier: string) => string;
  /**
   * Before the token is verified, check other
   * provided parameters.
   *
   * Used to make sure tha OTPs are accompanied
   * with the correct phone number.
   */
  authorize?: (
    /**
     * The values passed to the `signIn` function.
     */
    params: Record<string, Value | undefined>,
    account: GenericDoc<DataModel, "Account">,
  ) => Promise<void>;
  options: PhoneUserConfig<DataModel>;
}

/**
 * Configurable options for a phone provider config.
 */
export type PhoneUserConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> = Omit<Partial<PhoneConfig<DataModel>>, "options" | "type">;

/**
 * Credentials provider config used by Convex Auth.
 */
export type ConvexCredentialsConfig = CredentialsUserConfig<any> & {
  type: "credentials";
  id: string;
};

/**
 * Configuration for the passkey (WebAuthn) provider.
 */
export interface PasskeyProviderConfig {
  id: string;
  type: "passkey";
  options: {
    /** Relying Party display name. Defaults to SITE_URL hostname. */
    rpName?: string;
    /** Relying Party ID (hostname). Defaults to SITE_URL hostname. */
    rpId?: string;
    /** Allowed origins for credential verification. Defaults to SITE_URL. */
    origin?: string | string[];
    /** Attestation conveyance preference. Defaults to "none". */
    attestation?: "none" | "direct";
    /** User verification requirement. Defaults to "required". */
    userVerification?: "required" | "preferred" | "discouraged";
    /** Resident key (discoverable credential) preference. Defaults to "preferred". */
    residentKey?: "required" | "preferred" | "discouraged";
    /** Restrict to platform or cross-platform authenticators. */
    authenticatorAttachment?: "platform" | "cross-platform";
    /** Supported COSE algorithms. Defaults to [-7 (ES256), -257 (RS256)]. */
    algorithms?: number[];
    /** Challenge expiration in ms. Defaults to 300_000 (5 minutes). */
    challengeExpirationMs?: number;
  };
}

/**
 * Configuration for the TOTP two-factor authentication provider.
 */
export interface TotpProviderConfig {
  id: string;
  type: "totp";
  options: {
    /** Issuer name shown in authenticator apps (e.g. "My App"). */
    issuer: string;
    /** Number of digits in each code (default: 6). */
    digits: number;
    /** Time period in seconds for code rotation (default: 30). */
    period: number;
  };
}

// ============================================================================
// OAuth types (Arctic-based)
// ============================================================================

/**
 * Normalized user profile returned by an OAuth provider.
 *
 * `id` is the provider-specific account identifier (e.g. GitHub user ID).
 */
export interface OAuthProfile {
  id: string;
  name?: string;
  email?: string;
  image?: string;
  /** Additional claims from the ID token or userinfo endpoint. */
  [key: string]: unknown;
}

/**
 * Internal config shape for an OAuth provider after normalization.
 *
 * This is what the OAuth flow code receives — it maps to the user-facing
 * `OAuthConfig` from `@robelest/convex-auth/providers`.
 *
 * @internal
 */
export interface OAuthProviderConfig {
  /** OAuth scopes to request. */
  scopes?: string[];
  /** User-provided profile extraction callback. */
  profile?: (tokens: import("arctic").OAuth2Tokens) => Promise<OAuthProfile>;
}

/** Credentials identifying a provider account (e.g. email + hashed password). */
export type AuthAccountCredentials = {
  /** Provider-specific account identifier (e.g. email address). */
  id: string;
  /** Optional secret (e.g. hashed password). */
  secret?: string;
};

/** Arguments for `auth.account.create()`. */
export type AuthCreateAccountArgs = {
  provider: string;
  account: AuthAccountCredentials;
  profile: Record<string, unknown> & {
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  };
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

/** Arguments for `auth.account.get()`. */
export type AuthRetrieveAccountArgs = {
  provider: string;
  account: AuthAccountCredentials;
};

/** Arguments for `auth.account.update()`. */
export type AuthUpdateAccountArgs = {
  provider: string;
  account: {
    id: string;
    secret: string;
  };
};

/** Arguments for `auth.session.invalidate()`. */
export type AuthInvalidateSessionsArgs = {
  userId: GenericId<"User">;
  except?: GenericId<"Session">[];
};

/** Arguments for `auth.provider.signIn()`. */
export type AuthProviderSignInArgs = {
  accountId?: GenericId<"Account">;
  params?: Record<string, Value | undefined>;
};

/** Return type of `auth.provider.signIn()` — user and session IDs, or `null` on failure. */
export type AuthProviderSignInResult = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
} | null;

/** Server-side auth helpers available on enriched action contexts. */
export type AuthServerHelpers = {
  account: {
    create: (
      ctx: GenericActionCtx<any>,
      args: AuthCreateAccountArgs,
    ) => Promise<{
      ok: true;
      account: GenericDoc<GenericDataModel, "Account">;
      user: GenericDoc<GenericDataModel, "User">;
    }>;
    get: (
      ctx: GenericActionCtx<any>,
      args: AuthRetrieveAccountArgs,
    ) => Promise<{
      account: GenericDoc<GenericDataModel, "Account">;
      user: GenericDoc<GenericDataModel, "User">;
    }>;
    update: (
      ctx: GenericActionCtx<any>,
      args: AuthUpdateAccountArgs,
    ) => Promise<{ ok: true; accountId: GenericId<"Account"> }>;
  };
  session: {
    current: (ctx: {
      auth: GenericActionCtx<GenericDataModel>["auth"];
    }) => Promise<GenericId<"Session"> | null>;
    invalidate: (
      ctx: GenericActionCtx<any>,
      args: AuthInvalidateSessionsArgs,
    ) => Promise<{
      ok: true;
      userId: GenericId<"User">;
      except: GenericId<"Session">[];
    }>;
  };
  access: {
    check: (
      ctx: GenericActionCtx<any>,
      args: {
        userId: GenericId<"User">;
        groupId: GenericId<"Group">;
        grants: string[];
        maxDepth?: number;
      },
    ) => Promise<{
      ok: boolean;
      grants: string[];
      missingGrants: string[];
      roleIds: string[];
      matchedGroupId: GenericId<"Group"> | null;
      membership: GenericDoc<GenericDataModel, "GroupMember"> | null;
      isDirect: boolean;
      isInherited: boolean;
      depth: number | null;
    }>;
  };
  provider: {
    signIn: (
      ctx: GenericActionCtx<any>,
      provider: AuthProviderConfig,
      args: AuthProviderSignInArgs,
    ) => Promise<AuthProviderSignInResult>;
  };
};

/**
 * Your `ActionCtx` enriched with `ctx.auth.config` field with
 * the config passed to `createAuth`.
 */
export type GenericActionCtxWithAuthConfig<DataModel extends GenericDataModel> =
  GenericActionCtx<DataModel> & {
    auth: GenericActionCtx<DataModel>["auth"] & {
      config: ConvexAuthMaterializedConfig;
    } & AuthServerHelpers;
  };

/**
 * The config for the Convex Auth library, passed to `createAuth`,
 * with defaults and initialized providers.
 *
 * See {@link ConvexAuthConfig}
 */
export type ConvexAuthMaterializedConfig = {
  providers: AuthProviderMaterializedConfig[];
} & Pick<
  ConvexAuthConfig,
  "component" | "session" | "jwt" | "signIn" | "callbacks" | "authorization"
>;

export interface SAMLAttributeMapping {
  subject?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Materialized OAuth provider config (Arctic-based).
 *
 * Carries the Arctic provider instance along with scopes and profile config.
 * Produced by materializing an `OAuthProviderInstance` during `configDefaults`.
 */
export interface OAuthMaterializedConfig {
  readonly id: string;
  readonly type: "oauth";
  /** The Arctic provider instance. */
  readonly provider: any;
  /** OAuth scopes to request. */
  readonly scopes: string[];
  /** User-provided profile extraction callback. */
  readonly profile?: (
    tokens: import("arctic").OAuth2Tokens,
  ) => Promise<OAuthProfile>;
  /** Account-linking policy for OAuth identities. Defaults to verified email linking. */
  readonly accountLinking?: "verifiedEmail" | "none";
}

/**
 * Device authorization provider config (RFC 8628).
 *
 * Enables input-constrained devices (CLIs, TVs, IoT) to authenticate
 * by displaying a short code that the user enters on a secondary device.
 */
export interface DeviceProviderConfig {
  id: string;
  type: "device";
  /** User code character set. Default: `"BCDFGHJKLMNPQRSTVWXZ"` (base-20, no vowels). */
  charset: string;
  /** User code length. Default: 8. */
  userCodeLength: number;
  /** Device code + user code lifetime in seconds. Default: 900 (15 min). */
  expiresIn: number;
  /** Minimum polling interval in seconds. Default: 5. */
  interval: number;
  /**
   * Base URL for the verification page (e.g. `"http://localhost:3000/device"`).
   *
   * This is where users go to enter the device code. If not provided,
   * falls back to `SITE_URL + "/device"`.
   */
  verificationUri?: string;
}

/**
 * Materialized auth provider config — the fully resolved form stored at runtime.
 */
export type AuthProviderMaterializedConfig =
  | OAuthMaterializedConfig
  | EmailConfig
  | PhoneConfig
  | ConvexCredentialsConfig
  | PasskeyProviderConfig
  | TotpProviderConfig
  | DeviceProviderConfig
  | SSOProviderConfig;

/**
 * Resolves to `true` when the providers list includes `SSO`, otherwise `false`.
 *
 * Used to make `auth.sso` conditionally present on the `createAuth`
 * return type — it only appears when `new SSO()` is in the providers array.
 */
export type HasSSO<P extends AuthProviderConfig[]> =
  import("../providers/sso").SSO extends P[number] ? true : false;

export type HasPasskeyProvider<P extends AuthProviderConfig[]> =
  import("../providers/passkey").Passkey extends P[number] ? true : false;

export type HasTotpProvider<P extends AuthProviderConfig[]> =
  import("../providers/totp").Totp extends P[number] ? true : false;

export type HasDeviceProvider<P extends AuthProviderConfig[]> =
  import("../providers/device").Device extends P[number] ? true : false;

// ============================================================================
// API Key types
// ============================================================================

/**
 * A single scope entry stored per API key.
 * Uses a resource:action pattern for structured permissions.
 *
 * ```ts
 * { resource: "users", actions: ["read", "list"] }
 * ```
 */
export interface KeyScope {
  resource: string;
  actions: string[];
}

/**
 * Result of scope verification. Provides a `.can()` helper
 * for checking if a key has a specific permission.
 *
 * ```ts
 * const result = await auth.key.verify(ctx, rawKey);
 * if (result.scopes.can("users", "read")) {
 *   // authorized
 * }
 * ```
 */
export interface ScopeChecker {
  /** Check if the key has permission for a given resource:action. */
  can(resource: string, action: string): boolean;
  /** The raw scope entries from the key. */
  scopes: KeyScope[];
}

/**
 * An API key record as returned by `auth.key.list()` and `auth.key.get()`.
 * Never includes the raw key material — only the display prefix.
 */
export interface KeyRecord {
  /** Document ID. */
  _id: string;
  /** Owner user ID. */
  userId: string;
  /** Display prefix (e.g. `"sk_abc1"`). Safe to show in UIs. */
  prefix: string;
  /** Human-readable name (e.g. "CI Pipeline"). */
  name: string;
  /** Resource:action permissions granted to this key. */
  scopes: KeyScope[];
  /** Per-key rate limit, if configured. */
  rateLimit?: { maxRequests: number; windowMs: number };
  /** Expiration timestamp (ms since epoch), or `undefined` for no expiry. */
  expiresAt?: number;
  /** Timestamp of last successful verification, or `undefined` if never used. */
  lastUsedAt?: number;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** `true` when the key has been revoked (soft-deleted). */
  revoked: boolean;
  /** Arbitrary app-specific metadata attached to the key. */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Unified List API types
// ============================================================================

/**
 * Options for paginated list queries. Every entity list method uses this
 * same shape with entity-specific `TWhere` and `TOrderBy` type parameters.
 *
 * ```ts
 * const result = await auth.group.list(ctx, {
 *   where: { type: "team" },
 *   limit: 20,
 *   orderBy: "name",
 *   order: "asc",
 * });
 * ```
 */
export type ListOptions<
  TWhere extends Record<string, unknown>,
  TOrderBy extends string,
> = {
  /** Serializable filter — only known fields for the entity. */
  where?: TWhere;
  /** Maximum number of items to return. Defaults to 50, max 100. */
  limit?: number;
  /** Opaque cursor from a previous `ListResult.nextCursor`. */
  cursor?: string | null;
  /** Field to sort by. Defaults to `"_creationTime"`. */
  orderBy?: TOrderBy;
  /** Sort direction. Defaults to `"desc"`. */
  order?: "asc" | "desc";
};

/**
 * Paginated list result returned by every entity list method.
 */
export type ListResult<T> = {
  /** The page of items. */
  items: T[];
  /** Opaque cursor for the next page, or `null` when exhausted. */
  nextCursor: string | null;
};

// -- Per-entity Where / OrderBy types --

/**
 * A single key/value tag for group classification.
 *
 * Tags are normalized at write time: both `key` and `value` are
 * trimmed and lowercased. Filtering is strict exact-match only.
 */
export type GroupTag = {
  key: string;
  value: string;
};

/** Filter fields for `auth.group.list()`. All optional. */
export type GroupWhere = {
  slug?: string;
  type?: string;
  parentGroupId?: string;
  name?: string;
  /** When `true`, return only root groups (no parent). When `false`, only non-root. */
  isRoot?: boolean;
  /**
   * Return only groups that have **all** of the specified tags.
   * Each tag is matched exactly on normalized `(key, value)`.
   */
  tagsAll?: GroupTag[];
  /**
   * Return only groups that have **at least one** of the specified tags.
   * Each tag is matched exactly on normalized `(key, value)`.
   */
  tagsAny?: GroupTag[];
};

/** Sortable fields for `auth.group.list()`. */
export type GroupOrderBy = "_creationTime" | "name" | "slug" | "type";

/** Filter fields for `auth.member.list()`. All optional. */
export type MemberWhere = {
  groupId?: string;
  userId?: string;
  roleId?: string;
  status?: string;
};

/** Sortable fields for `auth.member.list()`. */
export type MemberOrderBy = "_creationTime" | "status";

/** Filter fields for `auth.invite.list()`. All optional. */
export type InviteWhere = {
  tokenHash?: string;
  groupId?: string;
  status?: "pending" | "accepted" | "revoked" | "expired";
  email?: string;
  invitedByUserId?: string;
  roleId?: string;
  acceptedByUserId?: string;
};

/** Sortable fields for `auth.invite.list()`. */
export type InviteOrderBy =
  | "_creationTime"
  | "status"
  | "email"
  | "expiresTime"
  | "acceptedTime";

/** Filter fields for `auth.key.list()`. All optional. */
export type KeyWhere = {
  userId?: string;
  revoked?: boolean;
  name?: string;
  prefix?: string;
};

/** Sortable fields for `auth.key.list()`. */
export type KeyOrderBy =
  | "_creationTime"
  | "name"
  | "lastUsedAt"
  | "expiresAt"
  | "revoked";

/** Filter fields for `auth.user.list()`. All optional. */
export type UserWhere = {
  email?: string;
  phone?: string;
  isAnonymous?: boolean;
  name?: string;
};

/** Sortable fields for `auth.user.list()`. */
export type UserOrderBy = "_creationTime" | "name" | "email" | "phone";

// ============================================================================
// HTTP Bearer Auth types
// ============================================================================

/**
 * Context injected into `auth.http.action()` and `auth.http.route()` handlers.
 *
 * The handler's `ctx` receives these fields after Bearer token verification:
 *
 * ```ts
 * auth.http.route(http, {
 *   path: "/api/data",
 *   method: "GET",
 *   handler: async (ctx, request) => {
 *     ctx.key.userId;               // owner of the API key
 *     ctx.key.keyId;                // the key document ID
 *     ctx.key.scopes.can("data", "read"); // scope check
 *   },
 * });
 * ```
 */
export interface HttpKeyContext {
  key: {
    /** The user ID that owns the verified API key. */
    userId: string;
    /** The API key document ID. */
    keyId: string;
    /** Scope checker for the verified key's permissions. */
    scopes: ScopeChecker;
  };
}

/**
 * CORS configuration for Bearer-authenticated HTTP endpoints.
 */
export interface CorsConfig {
  /** Allowed origin(s). Defaults to `"*"`. */
  origin?: string;
  /** Allowed HTTP methods. Defaults to `"GET,POST,PUT,PATCH,DELETE,OPTIONS"`. */
  methods?: string;
  /** Allowed request headers. Defaults to `"Content-Type,Authorization"`. */
  headers?: string;
}

/**
 * Component function references required by core auth runtime.
 *
 * @internal Consumers should not depend on this shape — it may change
 * between minor versions. Pass `components.auth` directly to `createAuth`.
 */
export type AuthComponentApi = {
  public: {
    userGetById: FunctionReference<"query", "internal">;
    userList: FunctionReference<"query", "internal">;
    userFindByVerifiedEmail: FunctionReference<"query", "internal">;
    userFindByVerifiedPhone: FunctionReference<"query", "internal">;
    userInsert: FunctionReference<"mutation", "internal">;
    userUpsert: FunctionReference<"mutation", "internal">;
    userPatch: FunctionReference<"mutation", "internal">;
    userDelete: FunctionReference<"mutation", "internal">;
    accountGet: FunctionReference<"query", "internal">;
    accountGetById: FunctionReference<"query", "internal">;
    accountInsert: FunctionReference<"mutation", "internal">;
    accountListByUser: FunctionReference<"query", "internal">;
    accountPatch: FunctionReference<"mutation", "internal">;
    accountDelete: FunctionReference<"mutation", "internal">;
    sessionCreate: FunctionReference<"mutation", "internal">;
    sessionGetById: FunctionReference<"query", "internal">;
    sessionDelete: FunctionReference<"mutation", "internal">;
    sessionListByUser: FunctionReference<"query", "internal">;
    verifierCreate: FunctionReference<"mutation", "internal">;
    verifierGetById: FunctionReference<"query", "internal">;
    verifierGetBySignature: FunctionReference<"query", "internal">;
    verifierPatch: FunctionReference<"mutation", "internal">;
    verifierDelete: FunctionReference<"mutation", "internal">;
    verificationCodeGetByAccountId: FunctionReference<"query", "internal">;
    verificationCodeGetByCode: FunctionReference<"query", "internal">;
    verificationCodeCreate: FunctionReference<"mutation", "internal">;
    verificationCodeDelete: FunctionReference<"mutation", "internal">;
    refreshTokenCreate: FunctionReference<"mutation", "internal">;
    refreshTokenGetById: FunctionReference<"query", "internal">;
    refreshTokenPatch: FunctionReference<"mutation", "internal">;
    refreshTokenGetChildren: FunctionReference<"query", "internal">;
    refreshTokenListBySession: FunctionReference<"query", "internal">;
    refreshTokenDeleteAll: FunctionReference<"mutation", "internal">;
    refreshTokenGetActive: FunctionReference<"query", "internal">;
    rateLimitGet: FunctionReference<"query", "internal">;
    rateLimitCreate: FunctionReference<"mutation", "internal">;
    rateLimitPatch: FunctionReference<"mutation", "internal">;
    rateLimitDelete: FunctionReference<"mutation", "internal">;
    groupCreate: FunctionReference<"mutation", "internal">;
    groupGet: FunctionReference<"query", "internal">;
    groupList: FunctionReference<"query", "internal">;
    groupUpdate: FunctionReference<"mutation", "internal">;
    groupDelete: FunctionReference<"mutation", "internal">;
    memberAdd: FunctionReference<"mutation", "internal">;
    memberGet: FunctionReference<"query", "internal">;
    memberList: FunctionReference<"query", "internal">;
    memberListByUser: FunctionReference<"query", "internal">;
    memberGetByGroupAndUser: FunctionReference<"query", "internal">;
    memberRemove: FunctionReference<"mutation", "internal">;
    memberUpdate: FunctionReference<"mutation", "internal">;
    inviteCreate: FunctionReference<"mutation", "internal">;
    inviteGet: FunctionReference<"query", "internal">;
    inviteGetByTokenHash: FunctionReference<"query", "internal">;
    inviteList: FunctionReference<"query", "internal">;
    inviteAccept: FunctionReference<"mutation", "internal">;
    inviteAcceptByToken: FunctionReference<"mutation", "internal">;
    inviteRevoke: FunctionReference<"mutation", "internal">;
    keyInsert: FunctionReference<"mutation", "internal">;
    keyGetByHashedKey: FunctionReference<"query", "internal">;
    keyGetById: FunctionReference<"query", "internal">;
    keyList: FunctionReference<"query", "internal">;
    keyListByUserId: FunctionReference<"query", "internal">;
    keyPatch: FunctionReference<"mutation", "internal">;
    keyDelete: FunctionReference<"mutation", "internal">;
    passkeyInsert: FunctionReference<"mutation", "internal">;
    passkeyGetByCredentialId: FunctionReference<"query", "internal">;
    passkeyListByUserId: FunctionReference<"query", "internal">;
    passkeyUpdateCounter: FunctionReference<"mutation", "internal">;
    passkeyUpdateMeta: FunctionReference<"mutation", "internal">;
    passkeyDelete: FunctionReference<"mutation", "internal">;
    totpInsert: FunctionReference<"mutation", "internal", any, any>;
    totpGetVerifiedByUserId: FunctionReference<"query", "internal", any, any>;
    totpListByUserId: FunctionReference<"query", "internal", any, any>;
    totpGetById: FunctionReference<"query", "internal", any, any>;
    totpMarkVerified: FunctionReference<"mutation", "internal", any, any>;
    totpUpdateLastUsed: FunctionReference<"mutation", "internal", any, any>;
    totpDelete: FunctionReference<"mutation", "internal", any, any>;
    deviceInsert: FunctionReference<"mutation", "internal", any, any>;
    deviceGetByCodeHash: FunctionReference<"query", "internal", any, any>;
    deviceGetByUserCode: FunctionReference<"query", "internal", any, any>;
    deviceAuthorize: FunctionReference<"mutation", "internal", any, any>;
    deviceUpdateLastPolled: FunctionReference<"mutation", "internal", any, any>;
    deviceDelete: FunctionReference<"mutation", "internal", any, any>;
    enterpriseCreate: FunctionReference<"mutation", "internal", any, any>;
    enterpriseGet: FunctionReference<"query", "internal", any, any>;
    enterpriseGetByGroup: FunctionReference<"query", "internal", any, any>;
    enterpriseGetByDomain: FunctionReference<"query", "internal", any, any>;
    enterpriseList: FunctionReference<"query", "internal", any, any>;
    enterpriseUpdate: FunctionReference<"mutation", "internal", any, any>;
    enterpriseDelete: FunctionReference<"mutation", "internal", any, any>;
    enterpriseDomainAdd: FunctionReference<"mutation", "internal", any, any>;
    enterpriseDomainList: FunctionReference<"query", "internal", any, any>;
    enterpriseDomainDelete: FunctionReference<"mutation", "internal", any, any>;
    enterpriseDomainVerificationGet: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseDomainVerificationUpsert: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseDomainVerificationDelete: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseDomainVerify: FunctionReference<"mutation", "internal", any, any>;
    enterpriseSecretUpsert: FunctionReference<"mutation", "internal", any, any>;
    enterpriseSecretGet: FunctionReference<"query", "internal", any, any>;
    enterpriseSecretDelete: FunctionReference<"mutation", "internal", any, any>;
    enterpriseScimConfigUpsert: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseScimConfigGetByEnterprise: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimConfigGetByTokenHash: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityGet: FunctionReference<"query", "internal", any, any>;
    enterpriseScimIdentityGetByUser: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityGetByEnterpriseAndUser: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityGetByMappedGroup: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityListByEnterprise: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityUpsert: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseScimIdentityDelete: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseAuditEventCreate: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseAuditEventList: FunctionReference<"query", "internal", any, any>;
    enterpriseWebhookEndpointCreate: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseWebhookEndpointList: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseWebhookEndpointGet: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseWebhookEndpointUpdate: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseWebhookDeliveryEnqueue: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
    enterpriseWebhookDeliveryListReady: FunctionReference<
      "query",
      "internal",
      any,
      any
    >;
    enterpriseWebhookDeliveryPatch: FunctionReference<
      "mutation",
      "internal",
      any,
      any
    >;
  };
};

// ============================================================================
// Convex document types (merged from convex_types)
// ============================================================================

/**
 * Convex document from a given table.
 */
export type GenericDoc<
  DataModel extends GenericDataModel,
  TableName extends TableNamesInDataModel<DataModel>,
> = DocumentByName<DataModel, TableName> & {
  _id: GenericId<TableName>;
  _creationTime: number;
};

/**
 * @internal
 */
export type FunctionReferenceFromExport<Export> =
  Export extends RegisteredQuery<infer Visibility, infer Args, infer Output>
    ? FunctionReference<"query", Visibility, Args, ConvertReturnType<Output>>
    : Export extends RegisteredMutation<
          infer Visibility,
          infer Args,
          infer Output
        >
      ? FunctionReference<
          "mutation",
          Visibility,
          Args,
          ConvertReturnType<Output>
        >
      : Export extends RegisteredAction<
            infer Visibility,
            infer Args,
            infer Output
          >
        ? FunctionReference<
            "action",
            Visibility,
            Args,
            ConvertReturnType<Output>
          >
        : never;

type ConvertReturnType<T> = UndefinedToNull<Awaited<T>>;

type UndefinedToNull<T> = T extends void ? null : T;

// Internal server data-model types (merged from former internalTypes.ts)

/** Data model derived from the component schema. */
export type AuthDataModel = DataModelFromSchemaDefinition<typeof schema>;

/** Action context typed to the auth component's data model. */
export type ActionCtx = GenericActionCtx<AuthDataModel>;

/** Mutation context typed to the auth component's data model. */
export type MutationCtx = GenericMutationCtx<AuthDataModel>;

/** Query context typed to the auth component's data model. */
export type QueryCtx = GenericQueryCtx<AuthDataModel>;

/** A document from any table in the auth component schema. */
export type Doc<T extends TableNamesInDataModel<AuthDataModel>> = GenericDoc<
  AuthDataModel,
  T
>;

/** A pair of JWT access token and refresh token. */
export type Tokens = { token: string; refreshToken: string };

/** Session information returned after authentication. */
export type SessionInfo = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
  tokens: Tokens | null;
};

/** Session information with guaranteed non-null tokens. */
export type SessionInfoWithTokens = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
  tokens: Tokens;
};

// ---------------------------------------------------------------------------
// Cross-component document shapes
// ---------------------------------------------------------------------------
// These mirror the component schema tables. They exist so that server-side
// code can work with typed results from cross-component queries/mutations
// instead of casting to `any` at every field access.

export type TotpDoc = Infer<typeof vTotpFactorDoc>;

export type PasskeyDoc = Infer<typeof vPasskeyDoc>;

export type VerifierDoc = Infer<typeof vAuthVerifierDoc>;

/**
 * Cross-component user document shape inferred from the component validator.
 *
 * Used by internal typed wrappers (`queryUserById`, etc.) so server code stays
 * aligned with the component runtime contract. Not intended for consumer use —
 * consumers should use `UserDoc` (exported from
 * `@robelest/convex-auth/component`).
 *
 * @internal
 */
export type CrossComponentUserDoc = Infer<typeof vUserDoc>;

export type KeyDoc = Infer<typeof vApiKeyDoc>;

// ---------------------------------------------------------------------------
// Cross-component wrapper context
// ---------------------------------------------------------------------------
// Structural type accepted by all wrappers below.  Works for both action and
// mutation contexts — the only capabilities we need are runQuery / runMutation
// and access to the component API via `auth.config.component`.

/** @internal */
export type ComponentCallCtx = {
  runQuery: GenericActionCtx<AuthDataModel>["runQuery"];
  runMutation: GenericActionCtx<AuthDataModel>["runMutation"];
  auth: { config: { component: AuthComponentApi } };
};

// ---------------------------------------------------------------------------
// Typed wrappers for cross-component calls
// ---------------------------------------------------------------------------
// Each wrapper encapsulates the single `as any` cast at the component
// boundary so that callers get full type safety on both args and return
// values.

// -- User queries --

export async function queryUserById(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<CrossComponentUserDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.public.userGetById, {
    userId,
  })) as CrossComponentUserDoc | null;
}

export async function queryUserByVerifiedEmail(
  ctx: ComponentCallCtx,
  email: string,
): Promise<CrossComponentUserDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.userFindByVerifiedEmail,
    { email },
  )) as CrossComponentUserDoc | null;
}

// -- Verifier queries / mutations --

export async function queryVerifierById(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<VerifierDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.public.verifierGetById, {
    verifierId,
  })) as VerifierDoc | null;
}

export async function mutateVerifierDelete(
  ctx: ComponentCallCtx,
  verifierId: string,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.verifierDelete, {
    verifierId,
  });
}

// -- TOTP queries / mutations --

export async function queryTotpById(
  ctx: ComponentCallCtx,
  totpId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.public.totpGetById, {
    totpId,
  })) as TotpDoc | null;
}

export async function queryTotpVerifiedByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<TotpDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.totpGetVerifiedByUserId,
    { userId },
  )) as TotpDoc | null;
}

export async function mutateTotpInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    secret: ArrayBuffer;
    digits: number;
    period: number;
    verified: boolean;
    name?: string;
    createdAt: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.totpInsert,
    args,
  )) as string;
}

export async function mutateTotpMarkVerified(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.totpMarkVerified, {
    totpId,
    lastUsedAt,
  });
}

export async function mutateTotpUpdateLastUsed(
  ctx: ComponentCallCtx,
  totpId: string,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.totpUpdateLastUsed, {
    totpId,
    lastUsedAt,
  });
}

// -- Passkey queries / mutations --

export async function queryPasskeysByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<PasskeyDoc[]> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.passkeyListByUserId,
    { userId },
  )) as PasskeyDoc[];
}

export async function queryPasskeyByCredentialId(
  ctx: ComponentCallCtx,
  credentialId: string,
): Promise<PasskeyDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.passkeyGetByCredentialId,
    { credentialId },
  )) as PasskeyDoc | null;
}

export async function mutatePasskeyInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    credentialId: string;
    publicKey: ArrayBuffer | ArrayBufferLike;
    algorithm: number;
    counter: number;
    transports?: string[];
    deviceType: string;
    backedUp: boolean;
    name?: string;
    createdAt: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.passkeyInsert,
    args,
  )) as string;
}

export async function mutatePasskeyUpdateCounter(
  ctx: ComponentCallCtx,
  passkeyId: string,
  counter: number,
  lastUsedAt: number,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.passkeyUpdateCounter, {
    passkeyId,
    counter,
    lastUsedAt,
  });
}

// -- Key queries / mutations --

export async function mutateKeyInsert(
  ctx: ComponentCallCtx,
  args: {
    userId: string;
    prefix: string;
    hashedKey: string;
    name: string;
    scopes: Array<{ resource: string; actions: string[] }>;
    rateLimit?: { maxRequests: number; windowMs: number };
    expiresAt?: number;
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.keyInsert,
    args,
  )) as string;
}

export async function queryKeysByUserId(
  ctx: ComponentCallCtx,
  userId: string,
): Promise<KeyDoc[]> {
  return (await ctx.runQuery(ctx.auth.config.component.public.keyListByUserId, {
    userId,
  })) as KeyDoc[];
}

export async function queryKeyById(
  ctx: ComponentCallCtx,
  keyId: string,
): Promise<KeyDoc | null> {
  return (await ctx.runQuery(ctx.auth.config.component.public.keyGetById, {
    keyId,
  })) as KeyDoc | null;
}

export async function mutateKeyPatch(
  ctx: ComponentCallCtx,
  keyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.keyPatch, {
    keyId,
    data,
  });
}

export async function mutateKeyDelete(
  ctx: ComponentCallCtx,
  keyId: string,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.keyDelete, { keyId });
}

// -- Device authorization queries / mutations --

export type DeviceDoc = Infer<typeof vDeviceCodeDoc>;

export async function mutateDeviceInsert(
  ctx: ComponentCallCtx,
  args: {
    deviceCodeHash: string;
    userCode: string;
    expiresAt: number;
    interval: number;
    status: "pending" | "authorized" | "denied";
  },
): Promise<string> {
  return (await ctx.runMutation(
    ctx.auth.config.component.public.deviceInsert,
    args,
  )) as string;
}

export async function queryDeviceByCodeHash(
  ctx: ComponentCallCtx,
  deviceCodeHash: string,
): Promise<DeviceDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.deviceGetByCodeHash,
    { deviceCodeHash },
  )) as DeviceDoc | null;
}

export async function queryDeviceByUserCode(
  ctx: ComponentCallCtx,
  userCode: string,
): Promise<DeviceDoc | null> {
  return (await ctx.runQuery(
    ctx.auth.config.component.public.deviceGetByUserCode,
    { userCode },
  )) as DeviceDoc | null;
}

export async function mutateDeviceAuthorize(
  ctx: ComponentCallCtx,
  deviceId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.deviceAuthorize, {
    deviceId,
    userId,
    sessionId,
  });
}

export async function mutateDeviceUpdateLastPolled(
  ctx: ComponentCallCtx,
  deviceId: string,
  lastPolledAt: number,
): Promise<void> {
  await ctx.runMutation(
    ctx.auth.config.component.public.deviceUpdateLastPolled,
    { deviceId, lastPolledAt },
  );
}

export async function mutateDeviceDelete(
  ctx: ComponentCallCtx,
  deviceId: string,
): Promise<void> {
  await ctx.runMutation(ctx.auth.config.component.public.deviceDelete, {
    deviceId,
  });
}
