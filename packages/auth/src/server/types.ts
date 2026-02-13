import {
  Provider as AuthjsProviderConfig,
  CredentialsConfig,
  EmailConfig as AuthjsEmailConfig,
  OAuth2Config,
  OIDCConfig,
} from "@auth/core/providers";
import { Theme } from "@auth/core/types";
import {
  AnyDataModel,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
} from "convex/server";
import { GenericId, Value } from "convex/values";
import { CredentialsUserConfig } from "../providers/credentials.js";
import { GenericDoc } from "./convex_types.js";

/**
 * The config for the Convex Auth library, passed to `Auth`.
 */
export type ConvexAuthConfig = {
  /**
   * A list of authentication provider configs.
   *
   * You can import existing configs from
   * - `@auth/core/providers/<provider-name>`
   * - `@robelest/convex-auth/providers/<provider-name>`
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
   * Theme used for emails.
   * See [Auth.js theme docs](https://authjs.dev/reference/core/types#theme).
   */
  theme?: Theme;
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
    maxFailedAttempsPerHour?: number;
  };
  /**
   * API key configuration for programmatic access.
   *
   * Enables `auth.key.*` helpers for creating, verifying, and managing
   * API keys with scoped permissions and optional per-key rate limiting.
   */
  apiKeys?: ApiKeyConfig;
  callbacks?: {
    /**
     * Control which URLs are allowed as a destination after OAuth sign-in
     * and for magic links:
     *
     * ```ts
     * import GitHub from "@auth/core/providers/github";
     * import { Auth } from "@robelest/convex-auth/component";
     *
     * export const { auth, signIn, signOut, store } = Auth({
     *   providers: [GitHub],
     *   callbacks: {
     *     async redirect({ redirectTo }) {
     *       // Check that `redirectTo` is valid
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
        existingUserId: GenericId<"user"> | null;
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
    ) => Promise<GenericId<"user">>;
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
        userId: GenericId<"user">;
        /**
         * If this is a sign-in to an existing account,
         * this is the existing user ID linked to that account.
         */
        existingUserId: GenericId<"user"> | null;
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
};

/**
 * Same as Auth.js provider configs, but adds phone provider
 * for verification via SMS or another phone-number-connected messaging
 * service.
 */
export type AuthProviderConfig =
  | Exclude<
      AuthjsProviderConfig,
      CredentialsConfig | ((...args: any) => CredentialsConfig)
    >
  | ConvexCredentialsConfig
  | ((...args: any) => ConvexCredentialsConfig)
  | PhoneConfig
  | ((...args: any) => PhoneConfig)
  | PasskeyProviderConfig
  | ((...args: any) => PasskeyProviderConfig)
  | TotpProviderConfig
  | ((...args: any) => TotpProviderConfig);

/**
 * Extends the standard Auth.js email provider config
 * to allow additional checks during token verification.
 */
export interface EmailConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> extends AuthjsEmailConfig {
  /**
   * Before the token is verified, check other
   * provided parameters.
   *
   * Used to make sure tha OTPs are accompanied
   * with the correct email address.
   */
  authorize?: (
    /**
     * The values passed to the `signIn` function.
     */
    params: Record<string, Value | undefined>,
    account: GenericDoc<DataModel, "account">,
  ) => Promise<void>;
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
    account: GenericDoc<DataModel, "account">,
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
 * Similar to Auth.js Credentials config.
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

export type AuthAccountCredentials = {
  id: string;
  secret?: string;
};

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

export type AuthRetrieveAccountArgs = {
  provider: string;
  account: AuthAccountCredentials;
};

export type AuthUpdateAccountCredentialsArgs = {
  provider: string;
  account: {
    id: string;
    secret: string;
  };
};

export type AuthInvalidateSessionsArgs = {
  userId: GenericId<"user">;
  except?: GenericId<"session">[];
};

export type AuthProviderSignInArgs = {
  accountId?: GenericId<"account">;
  params?: Record<string, Value | undefined>;
};

export type AuthProviderSignInResult = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
} | null;

export type AuthServerHelpers = {
  account: {
    create: (
      ctx: GenericActionCtx<any>,
      args: AuthCreateAccountArgs,
    ) => Promise<{
      account: GenericDoc<GenericDataModel, "account">;
      user: GenericDoc<GenericDataModel, "user">;
    }>;
    get: (
      ctx: GenericActionCtx<any>,
      args: AuthRetrieveAccountArgs,
    ) => Promise<{
      account: GenericDoc<GenericDataModel, "account">;
      user: GenericDoc<GenericDataModel, "user">;
    }>;
    updateCredentials: (
      ctx: GenericActionCtx<any>,
      args: AuthUpdateAccountCredentialsArgs,
    ) => Promise<void>;
  };
  session: {
    current: (
      ctx: { auth: GenericActionCtx<GenericDataModel>["auth"] },
    ) => Promise<GenericId<"session"> | null>;
    invalidate: (
      ctx: GenericActionCtx<any>,
      args: AuthInvalidateSessionsArgs,
    ) => Promise<void>;
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
 * the config passed to `Auth`.
 */
export type GenericActionCtxWithAuthConfig<DataModel extends GenericDataModel> =
  GenericActionCtx<DataModel> & {
    auth: GenericActionCtx<DataModel>["auth"] & {
      config: ConvexAuthMaterializedConfig;
    } & AuthServerHelpers;
  };

/**
 * The config for the Convex Auth library, passed to `Auth`,
 * with defaults and initialized providers.
 *
 * See {@link ConvexAuthConfig}
 */
export type ConvexAuthMaterializedConfig = {
  providers: AuthProviderMaterializedConfig[];
  theme: Theme;
} & Pick<
  ConvexAuthConfig,
  "component" | "session" | "jwt" | "signIn" | "callbacks"
>;

/**
 * Materialized Auth.js provider config.
 */
export type AuthProviderMaterializedConfig =
  | OIDCConfig<any>
  | OAuth2Config<any>
  | EmailConfig
  | PhoneConfig
  | ConvexCredentialsConfig
  | PasskeyProviderConfig
  | TotpProviderConfig;

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
 * Configuration for API key support on the Auth class.
 *
 * ```ts
 * const auth = new Auth(components.auth, {
 *   providers: [github],
 *   apiKeys: {
 *     scopes: {
 *       users: ["read", "list", "create", "delete"],
 *       messages: ["read", "write"],
 *     },
 *     defaultRateLimit: { maxRequests: 1000, windowMs: 3600000 },
 *   },
 * });
 * ```
 */
export interface ApiKeyConfig {
  /**
   * Define the available resource:action scopes for your API keys.
   * Keys can only be created with scopes that are a subset of these.
   */
  scopes?: Record<string, string[]>;
  /**
   * Default rate limit applied to new keys when not specified per-key.
   * Uses a token-bucket algorithm.
   */
  defaultRateLimit?: { maxRequests: number; windowMs: number };
  /**
   * Key prefix. Defaults to `"sk_live_"`.
   */
  prefix?: string;
}

/**
 * An API key record as returned by `auth.key.list()` and `auth.key.get()`.
 * Never includes the raw key material — only the display prefix.
 */
export interface KeyRecord {
  _id: string;
  userId: string;
  prefix: string;
  name: string;
  scopes: KeyScope[];
  rateLimit?: { maxRequests: number; windowMs: number };
  expiresAt?: number;
  lastUsedAt?: number;
  createdAt: number;
  revoked: boolean;
}

/**
 * Component function references required by core auth runtime.
 */
export type AuthComponentApi = {
  public: {
    userGetById: FunctionReference<"query", "internal">;
    userFindByVerifiedEmail: FunctionReference<"query", "internal">;
    userFindByVerifiedPhone: FunctionReference<"query", "internal">;
    userInsert: FunctionReference<"mutation", "internal">;
    userUpsert: FunctionReference<"mutation", "internal">;
    userPatch: FunctionReference<"mutation", "internal">;
    accountGet: FunctionReference<"query", "internal">;
    accountGetById: FunctionReference<"query", "internal">;
    accountInsert: FunctionReference<"mutation", "internal">;
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
  };
};
