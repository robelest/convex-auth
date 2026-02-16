import {
  AnyDataModel,
  DocumentByName,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
  TableNamesInDataModel,
} from "convex/server";
import { GenericId, Value } from "convex/values";
import { CredentialsUserConfig } from "../providers/credentials";

// ============================================================================
// Utility types
// ============================================================================

/** A value that is either `T` or a `PromiseLike<T>`. */
export type Awaitable<T> = T | PromiseLike<T>;

/**
 * The config for the Convex Auth library, passed to `Auth`.
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
    maxFailedAttempsPerHour?: number;
  };
  /**
   * API key configuration for programmatic access.
   *
   * Enables `auth.key.*` helpers for creating, verifying, and managing
   * API keys with scoped permissions and optional per-key rate limiting.
   */
  apiKeys?: ApiKeyConfig;
  /**
   * Email transport configuration.
   *
   * Required for magic link authentication and the admin portal.
   * The library generates email content (subject, styled HTML); you
   * provide the delivery mechanism — Resend, SendGrid, SES, Postmark,
   * or any other provider.
   *
   * When configured, a magic link email provider (`id: "email"`) is
   * auto-registered — no need to add a separate Auth.js email provider
   * to `providers`.
   *
   * Works seamlessly with the `@convex-dev/resend` Convex component:
   *
   * ```ts
   * import { Resend } from "@convex-dev/resend";
   *
   * const resend = new Resend(components.resend, { testMode: false });
   *
   * const auth = new Auth(components.auth, {
   *   providers: [google],
   *   email: {
   *     from: "My App <noreply@example.com>",
   *     send: (ctx, params) => resend.sendEmail(ctx, params),
   *   },
   * });
   * ```
   *
   * Or with any email API directly:
   *
   * ```ts
   * email: {
   *   from: "My App <noreply@example.com>",
   *   send: async (_ctx, { from, to, subject, html }) => {
   *     await fetch("https://api.resend.com/emails", {
   *       method: "POST",
   *       headers: {
   *         Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
   *         "Content-Type": "application/json",
   *       },
   *       body: JSON.stringify({ from, to, subject, html }),
   *     });
   *   },
   * },
   * ```
   */
  email?: EmailTransport;
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
      * import { Auth } from "@robelest/convex-auth/component";
      *
      * export const { auth, signIn, signOut, store } = Auth({
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
 * Union of all supported auth provider config types.
 *
 * Includes Arctic-based OAuth providers (via the `OAuth()` factory),
 * plus library-native providers: credentials, email, phone, passkey
 * (WebAuthn), and TOTP (2FA). Each can be passed as a config object
 * or a factory function.
 */
export type AuthProviderConfig =
  | import("../providers/oauth").OAuthProviderInstance
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
  | ((...args: any) => DeviceProviderConfig);

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
    account: GenericDoc<DataModel, "account">,
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

/** Arguments for `auth.account.updateCredentials()`. */
export type AuthUpdateAccountCredentialsArgs = {
  provider: string;
  account: {
    id: string;
    secret: string;
  };
};

/** Arguments for `auth.session.invalidate()`. */
export type AuthInvalidateSessionsArgs = {
  userId: GenericId<"user">;
  except?: GenericId<"session">[];
};

/** Arguments for `auth.provider.signIn()`. */
export type AuthProviderSignInArgs = {
  accountId?: GenericId<"account">;
  params?: Record<string, Value | undefined>;
};

/** Return type of `auth.provider.signIn()` — user and session IDs, or `null` on failure. */
export type AuthProviderSignInResult = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
} | null;

/** Server-side auth helpers available on enriched action contexts. */
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
} & Pick<
  ConvexAuthConfig,
  "component" | "session" | "jwt" | "signIn" | "callbacks"
>;

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
  readonly profile?: (tokens: import("arctic").OAuth2Tokens) => Promise<OAuthProfile>;
  /**
   * Allow linking accounts by email even if the email is unverified.
   * Use with caution — only enable for providers you trust.
   */
  readonly allowDangerousEmailAccountLinking?: boolean;
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
  | DeviceProviderConfig;

// ============================================================================
// Email transport types
// ============================================================================

/**
 * Email delivery parameters passed to `EmailTransport.send`.
 */
export interface EmailMessage {
  /** Sender address (from `email.from` in your Auth config). */
  from: string;
  /** Recipient email address. */
  to: string;
  /** Email subject line. */
  subject: string;
  /** HTML body content. */
  html: string;
}

/**
 * Email transport configuration for the Auth library.
 *
 * Provides a delivery mechanism for library-generated emails
 * (magic links, portal admin sign-in). The library owns the
 * email content; you provide the transport.
 */
export interface EmailTransport {
  /** Sender address shown in the From field (e.g. "My App \<noreply@example.com\>"). */
  from: string;
  /**
   * Deliver an email. Called by the library for magic links and portal emails.
   *
   * Receives the Convex action context as the first argument, enabling
   * use with Convex components like `@convex-dev/resend`:
   *
   * ```ts
   * send: (ctx, params) => resend.sendEmail(ctx, params)
   * ```
   *
   * For plain HTTP email APIs, ignore the `ctx` parameter:
   *
   * ```ts
   * send: async (_ctx, { from, to, subject, html }) => {
   *   await fetch("https://api.resend.com/emails", { ... });
   * }
   * ```
   */
  send: (
    ctx: GenericActionCtx<any>,
    params: EmailMessage,
  ) => Promise<void>;
}

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
  /** Document ID. */
  _id: string;
  /** Owner user ID. */
  userId: string;
  /** Display prefix (e.g. `"sk_live_abc1"`). Safe to show in UIs. */
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

/** Filter fields for `auth.group.member.list()`. All optional. */
export type MemberWhere = {
  groupId?: string;
  userId?: string;
  role?: string;
  status?: string;
};

/** Sortable fields for `auth.group.member.list()`. */
export type MemberOrderBy = "_creationTime" | "role" | "status";

/** Filter fields for `auth.invite.list()`. All optional. */
export type InviteWhere = {
  groupId?: string;
  status?: "pending" | "accepted" | "revoked" | "expired";
  email?: string;
  invitedByUserId?: string;
  role?: string;
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
 * between minor versions. Pass `components.auth` directly to the `Auth` constructor.
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
    deviceInsert: FunctionReference<"mutation", "internal", any, any>;
    deviceGetByCodeHash: FunctionReference<"query", "internal", any, any>;
    deviceGetByUserCode: FunctionReference<"query", "internal", any, any>;
    deviceAuthorize: FunctionReference<"mutation", "internal", any, any>;
    deviceUpdateLastPolled: FunctionReference<"mutation", "internal", any, any>;
    deviceDelete: FunctionReference<"mutation", "internal", any, any>;
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
