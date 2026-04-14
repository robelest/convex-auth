import type { FunctionReference } from "convex/server";
import type { ConvexError, Value } from "convex/values";
import type * as Deferred from "effect/Deferred";

/**
 * Structural interface for any Convex client.
 * Satisfied by `ConvexClient` (`convex/browser`),
 * `ConvexReactClient` (`convex/react`), and similar transports.
 *
 * `clearAuth` is present on `ConvexReactClient` and `BaseConvexClient`
 * but not on the simplified `ConvexClient`. When available we call it
 * during sign-out for a clean deauthentication.
 */
export interface ConvexTransport {
  action(action: unknown, args: unknown): Promise<unknown>;
  setAuth(
    fetchToken: (args: {
      forceRefreshToken: boolean;
    }) => Promise<string | null | undefined>,
    onChange?: (isAuthenticated: boolean) => void,
  ): void;
  clearAuth?(): void;
}

/** Minimal action-only transport used for unauthenticated auth flows. */
export interface ActionTransport {
  action(action: unknown, args: unknown): Promise<unknown>;
}

export type SignInApiRef = { signIn: AuthApiRefs["signIn"] };

/** Pluggable key-value storage supplied by the host runtime. */
export interface Storage {
  getItem(
    key: string,
  ): string | null | undefined | Promise<string | null | undefined>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** Platform-neutral location/navigation hooks. */
export interface LocationRuntime {
  get(): URL | null;
  replace(relativeUrl: string): void | Promise<void>;
  redirect(url: URL): void | Promise<void>;
}

/** Cross-context synchronization hooks, such as browser storage events. */
export interface SyncRuntime {
  subscribe(
    key: string,
    callback: (value: string | null) => void | Promise<void>,
  ): (() => void) | null;
}

/** Cross-context mutex/locking primitive. */
export interface MutexRuntime {
  withKey<T>(key: string, callback: () => Promise<T>): Promise<T>;
}

/** Proxy request execution supplied by the host runtime. */
export interface ProxyRuntime {
  fetch(body: Record<string, unknown>, proxyPath: string): Promise<Response>;
}

/**
 * Platform-neutral client runtime dependencies.
 *
 * The core `client` package should depend only on these interfaces, while the
 * browser package can provide concrete implementations backed by DOM APIs.
 */
export interface ClientRuntime {
  environment?: "client" | "server";
  storage?: Storage | null;
  location?: LocationRuntime;
  sync?: SyncRuntime;
  mutex?: MutexRuntime;
  proxy?: ProxyRuntime;
}

/** Platform-specific factor adapters injected by entrypoints like `browser`. */
export interface ClientAdapters {
  passkey?: PasskeyClient;
  totp?: TotpClient;
  device?: DeviceClient;
}

export interface ClientAdapterDeps {
  proxy: string | undefined;
  convex: ConvexTransport;
  requireApiRefs: () => SignInApiRef;
  proxyFetch: (body: Record<string, unknown>) => Promise<unknown>;
  setTokenAndMaybeWait: (
    args:
      | {
          shouldStore: true;
          tokens: AuthSession | null;
          waitForHandshake: boolean;
          context: { provider?: string; flow: string };
        }
      | {
          shouldStore: false;
          tokens: { token: string } | null;
          waitForHandshake: boolean;
          context: { provider?: string; flow: string };
        },
  ) => Promise<boolean>;
}

export interface ClientAdapterFactories {
  passkey?: (deps: ClientAdapterDeps) => PasskeyClient;
}

export type AuthSession = {
  token: string;
  refreshToken: string;
};

export type SignInActionResult =
  | { kind: "signedIn"; tokens: AuthSession | null }
  | { kind: "redirect"; redirect: string; verifier: string }
  | { kind: "started" }
  | {
      kind: "passkeyOptions";
      options: Record<string, unknown>;
      verifier: string;
    }
  | { kind: "totpRequired"; verifier: string }
  | {
      kind: "totpSetup";
      totpSetup: { uri: string; secret: string; totpId: string };
      verifier: string;
    }
  | {
      kind: "deviceCode";
      deviceCode: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval: number;
      };
    };

/**
 * Device code response returned when signing in with the `"device"` provider.
 *
 * The device displays the `userCode` (or `verificationUriComplete`) and
 * polls via `auth.device.poll()` until the user authorizes.
 */
export type DeviceCodeResult = {
  /** High-entropy device code used for polling (keep secret). */
  deviceCode: string;
  /** Short human-readable code the user enters (e.g. "WDJB-MJHT"). */
  userCode: string;
  /** Base verification URL (e.g. "https://myapp.com/device"). */
  verificationUri: string;
  /** Verification URL with user code pre-filled as `?code=XXXX-XXXX`. */
  verificationUriComplete: string;
  /** Lifetime of the codes in seconds. */
  expiresIn: number;
  /** Minimum polling interval in seconds. */
  interval: number;
};

/**
 * Result of a `signIn` call.
 *
 * - `kind: "signedIn"` — credentials were accepted and the user is authenticated.
 * - `kind: "redirect"` — OAuth flow initiated; redirect the user to `redirect.toString()`.
 * - `kind: "totpRequired"` — credentials valid but 2FA is needed; call `auth.totp.verify()`.
 * - `kind: "deviceCode"` — device flow initiated; display the code and poll via `auth.device.poll()`.
 * - `kind: "started"` — a non-immediate flow started (for example email/phone verification).
 *
 * @see {@link AuthState}
 */
export type SignInResult =
  | { kind: "signedIn" }
  | { kind: "redirect"; redirect: URL; verifier: string }
  | { kind: "totpRequired"; verifier: string }
  | { kind: "deviceCode"; deviceCode: DeviceCodeResult }
  | { kind: "started" };

/**
 * Reactive auth state snapshot returned by `auth.state` and `auth.onChange`.
 *
 * @see {@link SignInResult}
 */
export type AuthState = {
  /** High-level auth phase for deterministic UI state handling. */
  phase: "loading" | "handshake" | "authenticated" | "unauthenticated";
  /** `true` during initial hydration before the first token is resolved. */
  isLoading: boolean;
  /** `true` only after Convex confirms authentication with the backend. */
  isAuthenticated: boolean;
  /** The raw JWT string, or `null` when not authenticated. */
  token: string | null;
};

/**
 * Typed Convex API references for the auth functions.
 * Pass these from your generated `api` object.
 *
 * @typeParam HasPasskey - Whether the passkey provider is configured.
 * @typeParam HasTotp - Whether the TOTP provider is configured.
 * @typeParam HasDevice - Whether the device provider is configured.
 */
export type AuthApiRefs<
  HasPasskey extends boolean = boolean,
  HasTotp extends boolean = boolean,
  HasDevice extends boolean = boolean,
> = {
  signIn: FunctionReference<"action", "public", Record<string, Value>, unknown>;
  signOut: FunctionReference<
    "action",
    "public",
    Record<string, Value>,
    unknown
  >;
  store: FunctionReference<
    "mutation",
    "public",
    Record<string, Value>,
    unknown
  >;
  /** @internal Set automatically by `createAuth` — do not set manually. */
  _capabilities?: {
    passkey: HasPasskey;
    totp: HasTotp;
    device: HasDevice;
  };
};

/**
 * Passkey (WebAuthn) client-side helpers.
 *
 * @see {@link TotpClient}
 * @see {@link DeviceClient}
 */
export interface PasskeyClient {
  /**
   * Check whether the current runtime exposes WebAuthn passkey APIs.
   *
   * @returns `true` when `navigator.credentials` is available.
   *
   * @example
   * ```ts
   * if (auth.passkey.isSupported()) {
   *   // Show passkey registration button
   * }
   * ```
   */
  isSupported(): boolean;

  /**
   * Check whether conditional mediation (autofill-style passkeys) is available.
   *
   * @returns `true` when the browser supports `PublicKeyCredential.isConditionalMediationAvailable`.
   *
   * @example
   * ```ts
   * if (await auth.passkey.isAutofillSupported()) {
   *   await auth.passkey.authenticate({ autofill: true });
   * }
   * ```
   */
  isAutofillSupported(): Promise<boolean>;

  /**
   * Start a passkey registration flow and complete the WebAuthn ceremony.
   *
   * Creates a new credential bound to the current user's account.
   *
   * @param opts - Optional registration hints.
   * @param opts.name - Human-readable name for the passkey (e.g. `"MacBook Pro"`).
   * @param opts.email - Email hint for discoverable credentials.
   * @param opts.userName - WebAuthn `user.name` override.
   * @param opts.userDisplayName - WebAuthn `user.displayName` override.
   * @returns A {@link SignInResult} — typically `{ kind: "signedIn" }` on success.
   *
   * @example
   * ```ts
   * const result = await auth.passkey.register({ name: "My laptop" });
   * ```
   */
  register(opts?: Record<string, unknown>): Promise<SignInResult>;

  /**
   * Authenticate with an existing passkey and complete the WebAuthn ceremony.
   *
   * @param opts - Optional authentication hints.
   * @param opts.email - Email hint to filter discoverable credentials.
   * @param opts.autofill - Set to `true` for conditional UI (autofill) mode.
   * @returns A {@link SignInResult} — typically `{ kind: "signedIn" }` on success.
   *
   * @example
   * ```ts
   * const result = await auth.passkey.authenticate();
   * ```
   */
  authenticate(opts?: Record<string, unknown>): Promise<SignInResult>;
}

/**
 * TOTP two-factor authentication client-side helpers.
 *
 * @see {@link PasskeyClient}
 * @see {@link DeviceClient}
 */
export interface TotpClient {
  /**
   * Start TOTP enrollment and return the setup URI, secret, verifier, and factor ID.
   *
   * The returned `uri` is an `otpauth://` URL that can be rendered as a QR code
   * for the user to scan with their authenticator app.
   *
   * @param opts - Optional setup hints.
   * @param opts.name - Issuer name shown in the authenticator app.
   * @param opts.accountName - Account label in the authenticator app.
   * @returns An object with `{ uri, secret, verifier, totpId }`.
   *
   * @example
   * ```ts
   * const { uri, secret, verifier, totpId } = await auth.totp.setup();
   * // Render `uri` as a QR code, then confirm:
   * await auth.totp.confirm({ code: userCode, verifier, totpId });
   * ```
   */
  setup(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;

  /**
   * Confirm a newly created TOTP factor with the first authenticator code.
   *
   * Call this after the user scans the QR code and enters the first OTP.
   *
   * @param opts - Confirmation parameters.
   * @param opts.code - The 6-digit TOTP code from the authenticator app.
   * @param opts.verifier - The verifier string returned by {@link TotpClient.setup}.
   * @param opts.totpId - The factor ID returned by {@link TotpClient.setup}.
   *
   * @example
   * ```ts
   * await auth.totp.confirm({ code: "123456", verifier, totpId });
   * ```
   */
  confirm(opts: Record<string, unknown>): Promise<void>;

  /**
   * Complete a sign-in that is waiting on TOTP verification.
   *
   * Called when `signIn()` returns `{ kind: "totpRequired" }`.
   *
   * @param opts - Verification parameters.
   * @param opts.code - The 6-digit TOTP code from the authenticator app.
   * @param opts.verifier - The verifier string from the `totpRequired` result.
   *
   * @example
   * ```ts
   * const result = await auth.signIn("password", { email, password });
   * if (result.kind === "totpRequired") {
   *   await auth.totp.verify({ code: totpCode, verifier: result.verifier });
   * }
   * ```
   */
  verify(opts: Record<string, unknown>): Promise<void>;
}

/**
 * Device authorization (RFC 8628) client-side helpers.
 *
 * @see {@link PasskeyClient}
 * @see {@link TotpClient}
 */
export interface DeviceClient {
  /**
   * Poll until a device flow is approved or expires.
   *
   * Polls the server at the interval specified in the {@link DeviceCodeResult}
   * until the user authorizes the device or the code expires.
   *
   * @param opts - Poll options.
   * @param opts.code - The {@link DeviceCodeResult} returned from `signIn("device")`.
   * @throws `ConvexError({ code: "DEVICE_CODE_EXPIRED" })` when the code expires before authorization.
   *
   * @example
   * ```ts
   * const result = await auth.signIn("device");
   * if (result.kind === "deviceCode") {
   *   // Display result.deviceCode.userCode to the user
   *   await auth.device.poll({ code: result.deviceCode });
   *   console.log("Device authorized!");
   * }
   * ```
   */
  poll(opts: { code: DeviceCodeResult }): Promise<void>;

  /**
   * Approve a device flow from the verification page using the displayed user code.
   *
   * Call this on the authorization page where the user enters the short code
   * shown on the device screen.
   *
   * @param opts - Verification options.
   * @param opts.code - The user code string (e.g. `"WDJB-MJHT"`).
   * @throws `ConvexError({ code: "DEVICE_AUTHORIZATION_FAILED" })` when verification fails.
   *
   * @example
   * ```ts
   * await auth.device.verify({ code: "WDJB-MJHT" });
   * ```
   */
  verify(opts: { code: string }): Promise<void>;
}

/**
 * Extract capability flags from an AuthApiRefs type.
 *
 * @typeParam Api - An AuthApiRefs type to extract capability flags from.
 */
export type InferCaps<Api extends AuthApiRefs<boolean, boolean, boolean>> =
  Api extends AuthApiRefs<infer P, infer T, infer D>
    ? { passkey: P; totp: T; device: D }
    : { passkey: boolean; totp: boolean; device: boolean };

/** Pending invite detected from URL or recovered from storage after redirect. */
export interface PendingInvite {
  /**
   * Raw one-time invite token. Pass to your invite acceptance mutation.
   * @readonly
   */
  readonly token: string;
  /**
   * Invite email from the URL or stored redirect state, if available.
   * @readonly
   */
  readonly email: string | null;
  /**
   * Consume the invite: clears storage/URL params and returns the token.
   *
   * @returns The invite token.
   * @throws When there is no pending invite to accept.
   */
  accept(): Promise<{ token: string }>;
}

/** Base auth client — always present. */
export interface AuthClientBase {
  /**
   * Reactive auth state snapshot.
   * @readonly
   */
  readonly state: AuthState;
  /** SSR-safe query-param reader. */
  param: (name: string) => string | null;
  /**
   * Pending invite recovered from the URL or storage, if present.
   * @readonly
   */
  readonly invite: PendingInvite | null;
  /** Start a sign-in flow for a provider. */
  signIn: (
    provider: string,
    params?: Record<string, unknown>,
  ) => Promise<SignInResult>;
  /** Sign out and clear local auth state. */
  signOut: () => Promise<void>;
  /** Subscribe to auth state changes. Returns an unsubscribe function. */
  onChange: (callback: (state: AuthState) => void) => () => void;
  /** Tear down listeners and reject in-flight handshakes. */
  destroy: () => void;
}

/**
 * Framework-agnostic auth client return type.
 *
 * Conditionally includes `totp` and `device` helpers based on the
 * capabilities in the `AuthApiRefs` type. Browser-only `passkey` helpers are
 * added by {@link BrowserAuthClient}.
 *
 * @typeParam Api - An AuthApiRefs type that determines which factor helpers are included.
 */
export type AuthClient<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
> = AuthClientBase &
  (InferCaps<Api>["totp"] extends true ? { totp: TotpClient } : {}) &
  (InferCaps<Api>["device"] extends true ? { device: DeviceClient } : {});

/**
 * Browser auth client return type.
 *
 * Extends {@link AuthClient} with conditional passkey helpers when the
 * generated auth API exposes passkey capabilities.
 *
 * @typeParam Api - An AuthApiRefs type that determines which factor helpers are included.
 */
export type BrowserAuthClient<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
> = AuthClient<Api> &
  (InferCaps<Api>["passkey"] extends true ? { passkey: PasskeyClient } : {});

/**
 * Options for {@link client}.
 *
 * @typeParam Api - An AuthApiRefs type.
 */
export type ClientOptions<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
> = {
  /** Any Convex client implementation used to run auth actions. */
  convex: ConvexTransport;
  /** Platform runtime implementation used by the client core. */
  runtime?: ClientRuntime;
  /** Platform-specific factor adapters supplied by higher-level entrypoints. */
  adapters?: ClientAdapters;
  /** Platform-specific adapter factories supplied by higher-level entrypoints. */
  adapterFactories?: ClientAdapterFactories;
  /**
   * Typed auth function refs from your generated `api` object.
   * Required outside proxy mode.
   */
  api?: Api;
  /** Explicit Convex deployment URL when it cannot be inferred from the client. */
  url?: string;
  /**
   * Optional action-only transport for direct code exchange outside proxy mode.
   * Required in non-browser runtimes when `proxyPath` is not set.
   */
  httpClient?: ActionTransport | null;
  /**
   * Storage backend for persisted tokens.
   *
   * Defaults to `runtime.storage` when provided, otherwise `null`.
   */
  storage?: Storage | null;
  /** Override how OAuth code cleanup updates the current URL. */
  replaceUrl?: (relativeUrl: string) => void | Promise<void>;
  /**
   * Proxy endpoint used instead of direct Convex auth calls.
   * When set, provide `runtime.proxy` and omit direct `api`/`httpClient`
   * transport requirements.
   */
  proxyPath?: string;
  /** Server-provided JWT seed used for flash-free SSR hydration. */
  tokenSeed?: string | null;
  /** SSR-safe URL source for reading query parameters. */
  location?: URL | (() => URL | null);
};

export type AuthHandshakeErrorCode =
  | "AUTH_HANDSHAKE_TIMEOUT"
  | "AUTH_HANDSHAKE_REJECTED";

export type AuthFlowContext = {
  provider?: string;
  flow: string;
};

export type HandshakeWaiter = {
  epoch: number;
  context: AuthFlowContext;
  deferred: Deferred.Deferred<void, ConvexError<Value>>;
  timeoutId: ReturnType<typeof setTimeout>;
};
