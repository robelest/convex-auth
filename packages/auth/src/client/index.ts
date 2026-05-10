import { ConvexError, Value } from "convex/values";

import { LOG_LEVELS, logMessage } from "../shared/log";
import {
  createDeferred,
  type AuthApiRefs,
  type AuthClient,
  type AuthFlowContext,
  type AuthState,
  type OAuthCompletionResult,
  type ClientAdapterDeps,
  type ActionTransport,
  type ClientAdapters,
  type ClientRuntime,
  type ClientOptions,
  type ConvexTransport,
  type DeviceCodeResult,
  type HandshakeWaiter,
  type PendingInvite,
  type SignInActionResult,
  type SignInResult,
} from "./core/types";
import type { AuthTokens } from "../shared/results";
import { createHandshakeError } from "./errors";
import { createDeviceClient } from "./factors/device";
import { createTotpClient } from "./factors/totp";
import { createInviteManager } from "./runtime/invite";
import { localMutex } from "./runtime/mutex";
import {
  isRetriableProxyRefreshError,
  isTransientNetworkError,
  parseProxyErrorBody,
} from "./runtime/proxy";
import { createStorageHelpers } from "./runtime/storage";
import { ClientAdapterFactoriesLive, ClientAdaptersLive } from "./services/adapters";
import { ClientHttpLive } from "./services/http";
import { resolveClientServices } from "./services/resolve";
import { ClientRuntimeLive } from "./services/runtime";

export type {
  AnonymousParams,
  AuthApiRefs,
  AuthClient,
  AuthState,
  BrowserAuthClient,
  ClientOptions,
  ClientRuntime,
  CodeCompletionParams,
  DeviceClient,
  DeviceCodeResult,
  DevicePollParams,
  DeviceVerifyParams,
  EmailInitiateParams,
  OAuthCompletionResult,
  OAuthSignInParams,
  PasskeyClient,
  PasskeyRegisterOptions,
  PasskeySignInOptions,
  PasskeySignInParams,
  PasswordParams,
  PendingInvite,
  PlatformAuthClient,
  SignInOverloads,
  SignInResult,
  SsoParams,
  Storage,
  TotpClient,
  TotpConfirmParams,
  TotpSetupOptions,
  TotpSetupResult,
  TotpVerifyParams,
} from "./core/types";

const VERIFIER_STORAGE_KEY = "__convexAuthOAuthVerifier";
const JWT_STORAGE_KEY = "__convexAuthJWT";
const REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken";
const INVITE_TOKEN_KEY = "__convexAuthPendingInvite";
const INVITE_EMAIL_KEY = "__convexAuthPendingInviteEmail";

const RETRY_BASE_MS = 500;
const RETRY_MAX_RETRIES = 2;
const AUTH_HANDSHAKE_TIMEOUT_MS = 5000;

async function retryWithJitteredBackoff<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= RETRY_MAX_RETRIES || !shouldRetry(error)) {
        throw error;
      }
      const baseDelay = RETRY_BASE_MS * Math.pow(2, attempt);
      const jitter = baseDelay * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, jitter));
      attempt++;
    }
  }
}

/**
 * Resolve the Convex deployment URL from the client.
 *
 * `ConvexReactClient` exposes `.url` directly.
 * `ConvexClient` exposes `.client.url` via `BaseConvexClient`.
 */
function resolveUrl(convex: ConvexTransport, explicit?: string): string {
  if (explicit) return explicit;
  const candidate = convex as unknown as {
    url?: unknown;
    client?: { url?: unknown } | null;
  };
  const client =
    typeof candidate.client === "object" && candidate.client !== null
      ? candidate.client
      : undefined;
  const url: unknown = candidate.url ?? client?.url;
  if (typeof url === "string") return url;
  throw new Error("Could not determine Convex deployment URL. Pass `url` explicitly.");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildSignInRequestKey(
  provider: string | undefined,
  params: Record<string, Value>,
): string {
  return stableStringify({ provider: provider ?? null, params });
}

function formDataEntries(formData: unknown): Iterable<[string, string | { name: string }]> {
  return formData as unknown as Iterable<[string, string | { name: string }]>;
}

/**
 * Create a framework-agnostic auth client.
 *
 * Returns an object with `signIn`, `signOut`, `onChange`, `state`, and any
 * factor helpers enabled by your configured providers. Platform-specific
 * passkey support is added by higher-level entrypoints such as
 * `@robelest/convex-auth/browser`.
 *
 * ### SPA mode (default)
 *
 * ```ts
 * import { ConvexClient } from 'convex/browser';
 * import { client } from '@robelest/convex-auth/client';
 * import { api } from '../convex/_generated/api';
 *
 * const convex = new ConvexClient(CONVEX_URL);
 * const auth = client({ convex, api: api.auth });
 * ```
 *
 * ### Proxy mode
 *
 * ```ts
 * const auth = client({
 *   convex,
 *   proxyPath: '/api/auth',
 *   tokenSeed: tokenFromServer, // JWT read from httpOnly cookie during SSR
 *   runtime: myRuntime,
 * });
 * ```
 *
 * In proxy mode all auth operations go through the injected proxy runtime.
 * Tokens are stored in httpOnly cookies server-side — the client
 * holds the JWT in memory only.
 *
 * @param options - Client configuration. See {@link ClientOptions}.
 * @typeParam Api - An AuthApiRefs type determining which factor helpers are available.
 * @returns Auth client with conditional `totp` and `device` helpers.
 * @throws {Error} When the Convex deployment URL cannot be determined and `url` is not passed explicitly.
 * @throws {Error} When `proxyPath` is not set and the `api` option is missing.
 * @throws {Error} When `proxyPath` is set and `runtime.proxy` is missing.
 */
export function client<Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs>(
  options: ClientOptions<Api>,
): AuthClient<Api> {
  const { convex, proxyPath, api: apiRefs } = options;
  const proxy = proxyPath;
  const services = resolveClientServices({
    runtime: ClientRuntimeLive(options.runtime ?? {}),
    adapters: ClientAdaptersLive(options.adapters ?? {}),
    adapterFactories: ClientAdapterFactoriesLive(options.adapterFactories ?? {}),
    http: ClientHttpLive(proxy ? null : (options.httpClient ?? null)),
  });
  const runtime: ClientRuntime = services.runtime;
  const adapters: ClientAdapters = services.adapters;

  function requireProxyRuntime() {
    if (!runtime.proxy) {
      throw new Error(
        "The `runtime.proxy` option is required when `proxyPath` is set. " +
          "Use `@robelest/convex-auth/browser` for browser defaults or inject a proxy runtime explicitly.",
      );
    }
    return runtime.proxy;
  }

  function requireApiRefs() {
    if (!apiRefs) {
      throw new Error(
        "The `api` option is required when `proxyPath` is not set. " + "Pass { api: api.auth }.",
      );
    }
    return apiRefs;
  }

  function requireHttpClient() {
    if (!httpClient) {
      throw new Error(
        "The `httpClient` option is required when `proxyPath` is not set in a non-browser runtime. " +
          "Use `@robelest/convex-auth/browser` for browser defaults or pass an action-only transport explicitly.",
      );
    }
    return httpClient;
  }

  const storage =
    options.storage !== undefined
      ? options.storage
      : runtime.storage !== undefined
        ? runtime.storage
        : null;
  const proxyRuntime = proxy ? requireProxyRuntime() : null;

  // ---------------------------------------------------------------------------
  // Location — SSR-safe URL reading
  // ---------------------------------------------------------------------------

  function getLocation(): URL | null {
    if (typeof options.location === "function") return options.location();
    if (options.location instanceof URL) return options.location;
    if (runtime.location) return runtime.location.get();
    return null;
  }

  /**
   * SSR-safe URL parameter reader.
   *
   * Uses the injected location source when provided.
   *
   * @param name - The query parameter name.
   * @returns The parameter value, or `null` if not present or in SSR.
   *
   * @example
   * ```ts
   * const workspaceId = auth.param("workspace");
   * const tab = auth.param("tab") ?? "issues";
   * ```
   */
  function param(name: string): string | null {
    const loc = getLocation();
    return loc?.searchParams.get(name) ?? null;
  }

  function cleanUrlParams(params: string[]) {
    const loc = getLocation();
    if (!loc) return;
    if (!runtime.location) return;
    const searchParams = new URLSearchParams(loc.search);
    let changed = false;
    for (const p of params) {
      if (searchParams.has(p)) {
        searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) {
      const next = searchParams.toString() ? `${loc.pathname}?${searchParams}` : loc.pathname;
      void runtime.location.replace(next);
    }
  }

  const url = proxy ? undefined : resolveUrl(convex, options.url);
  const escapedNamespace = (proxy ?? url!)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "_");
  const key = (name: string) => `${name}_${escapedNamespace}`;
  const {
    get: storageGet,
    set: storageSet,
    remove: storageRemove,
  } = createStorageHelpers({ storage, key });
  const proxyFetch = async (body: Record<string, unknown>) => {
    if (!proxy) {
      throw new Error("Proxy fetch requested without proxyPath.");
    }
    const response = await proxyRuntime!.fetch(body, proxy);
    if (!response.ok) {
      let errorBody: Record<string, unknown> = {};
      try {
        errorBody = parseProxyErrorBody(await response.json()) as Record<string, unknown>;
      } catch {
        errorBody = {};
      }
      if (
        typeof errorBody === "object" &&
        errorBody !== null &&
        "authError" in errorBody &&
        typeof (errorBody as Record<string, unknown>).authError === "object"
      ) {
        throw new ConvexError((errorBody as Record<string, unknown>).authError as Value);
      }
      throw new Error(
        ((errorBody as Record<string, unknown>).error as string) ??
          `Proxy request failed: ${response.status}`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error("Proxy response was not valid JSON");
    }
  };
  const subscribers = new Set<() => void>();
  let disposeStorageListener: (() => void) | null = null;

  // Unauthenticated HTTP client for code verification & OAuth exchange.
  // Only needed in SPA mode — proxy mode routes everything through the proxy.
  const httpClient: ActionTransport | null = services.httpClient;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // If a server-provided token was supplied (SSR hydration), treat it as
  // immediately authenticated to avoid a handshake-only loading screen.
  const serverToken =
    typeof options.tokenSeed === "string" && options.tokenSeed.trim().length > 0
      ? options.tokenSeed
      : null;
  const hasServerToken = serverToken !== null;

  let token: string | null = serverToken;
  let isLoading = !hasServerToken;
  let authConfirmed = hasServerToken;
  let handshakePending = false;
  let authEpoch = 0;
  let destroyed = false;
  let activeSignIn: {
    key: string;
    promise: Promise<SignInResult>;
  } | null = null;
  let initializePromise: Promise<void> | null = null;
  const handshakeWaiters = new Set<HandshakeWaiter>();
  let snapshot: AuthState = {
    phase: hasServerToken ? "authenticated" : isLoading ? "loading" : "unauthenticated",
    isLoading,
    isAuthenticated: hasServerToken,
    token,
  };

  const settleHandshakeWaiters = (
    epoch: number,
    outcome: { type: "resolve" } | { type: "reject"; error: ConvexError<Value> },
  ) => {
    for (const waiter of Array.from(handshakeWaiters)) {
      if (waiter.epoch !== epoch) {
        continue;
      }
      clearTimeout(waiter.timeoutId);
      handshakeWaiters.delete(waiter);
      if (outcome.type === "resolve") {
        waiter.deferred.resolve(undefined);
      } else {
        waiter.deferred.reject(outcome.error);
      }
    }
  };

  const rejectObsoleteHandshakeWaiters = (activeEpoch: number) => {
    for (const waiter of Array.from(handshakeWaiters)) {
      if (waiter.epoch >= activeEpoch) {
        continue;
      }
      clearTimeout(waiter.timeoutId);
      handshakeWaiters.delete(waiter);
      waiter.deferred.reject(
        createHandshakeError("AUTH_HANDSHAKE_REJECTED", {
          ...waiter.context,
          reason: "token_changed",
        }),
      );
    }
  };

  const waitForAuthHandshake = async (context: AuthFlowContext) => {
    if (token === null) {
      return;
    }
    if (authConfirmed && !handshakePending) {
      return;
    }
    if (!handshakePending) {
      throw createHandshakeError("AUTH_HANDSHAKE_REJECTED", {
        ...context,
        reason: "auth_rejected",
      });
    }

    const epoch = authEpoch;
    const deferred = createDeferred<void, ConvexError<Value>>();
    const waiter: HandshakeWaiter = {
      epoch,
      context,
      deferred,
      timeoutId: setTimeout(() => {
        handshakeWaiters.delete(waiter);
        deferred.reject(
          createHandshakeError("AUTH_HANDSHAKE_TIMEOUT", {
            ...context,
            timeoutMs: AUTH_HANDSHAKE_TIMEOUT_MS,
          }),
        );
      }, AUTH_HANDSHAKE_TIMEOUT_MS),
    };
    handshakeWaiters.add(waiter);
    try {
      await deferred.promise;
    } finally {
      clearTimeout(waiter.timeoutId);
      handshakeWaiters.delete(waiter);
    }
  };

  const handleConvexAuthChange = (isAuthenticated: boolean) => {
    if (destroyed) {
      return;
    }

    if (isAuthenticated) {
      authConfirmed = true;
      handshakePending = false;
      settleHandshakeWaiters(authEpoch, { type: "resolve" });
    } else {
      authConfirmed = false;
      // Do not reject immediately while a handshake is pending.
      // Convex can transiently emit `false` while reauth is still in flight,
      // and a subsequent `true` confirms the same session.
    }

    if (updateSnapshot()) {
      notify();
    }
  };

  const notify = () => {
    for (const cb of subscribers) cb();
  };

  const updateSnapshot = () => {
    const tag =
      token !== null && handshakePending
        ? "handshake"
        : isLoading
          ? "loading"
          : token !== null && authConfirmed
            ? "authenticated"
            : "unauthenticated";

    const phase = tag as AuthState["phase"];

    const next: AuthState = {
      phase,
      isLoading: phase === "loading" || phase === "handshake",
      isAuthenticated: phase === "authenticated",
      token,
    };
    if (
      snapshot.phase === next.phase &&
      snapshot.isLoading === next.isLoading &&
      snapshot.isAuthenticated === next.isAuthenticated &&
      snapshot.token === next.token
    ) {
      return false;
    }
    snapshot = next;
    return true;
  };

  const finalizeLoadingState = () => {
    if (!isLoading) {
      return;
    }
    isLoading = false;
    if (updateSnapshot()) {
      notify();
    }
  };

  const inviteManager = createInviteManager({
    param,
    storageGet,
    storageSet,
    storageRemove,
    cleanUrlParams,
    tokenKey: INVITE_TOKEN_KEY,
    emailKey: INVITE_EMAIL_KEY,
  });
  const getPendingInvite = () => inviteManager.getPendingInvite();
  const persistInvite = () => inviteManager.persistInvite();
  const acceptInvite = () => inviteManager.acceptInvite();

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  const bindConvexAuth = () => {
    convex.setAuth(fetchAccessToken, handleConvexAuthChange);
  };

  const setToken = async (
    args:
      | {
          shouldStore: true;
          tokens: AuthTokens | null;
          requireHandshake?: boolean;
          resyncConvexAuth?: boolean;
        }
      | {
          shouldStore: false;
          tokens: { token: string } | null;
          requireHandshake?: boolean;
          resyncConvexAuth?: boolean;
        },
  ) => {
    const previousToken = token;

    if (args.tokens === null) {
      token = null;
      if (args.shouldStore) {
        await storageRemove(JWT_STORAGE_KEY);
        await storageRemove(REFRESH_TOKEN_STORAGE_KEY);
      }
    } else {
      token = args.tokens.token;
      if (args.shouldStore && "refreshToken" in args.tokens) {
        await storageSet(JWT_STORAGE_KEY, args.tokens.token);
        await storageSet(REFRESH_TOKEN_STORAGE_KEY, args.tokens.refreshToken);
      }
    }

    if (token !== previousToken) {
      authEpoch += 1;
      rejectObsoleteHandshakeWaiters(authEpoch);
    }

    if (token === null) {
      authConfirmed = false;
      handshakePending = false;
      settleHandshakeWaiters(authEpoch, {
        type: "reject",
        error: createHandshakeError("AUTH_HANDSHAKE_REJECTED", {
          reason: "token_cleared",
        }),
      });
    } else {
      const shouldEnterHandshake = args.requireHandshake === true || !authConfirmed;
      if (shouldEnterHandshake) {
        authConfirmed = false;
        handshakePending = true;
      } else {
        handshakePending = false;
      }
    }

    const hadPendingLoad = isLoading;
    isLoading = false;
    const changed = updateSnapshot();
    if (args.resyncConvexAuth !== false) {
      bindConvexAuth();
    }
    if (hadPendingLoad || changed) {
      notify();
    }
  };

  const setTokenAndMaybeWait = async (
    args:
      | {
          shouldStore: true;
          tokens: AuthTokens | null;
          waitForHandshake: boolean;
          context: AuthFlowContext;
        }
      | {
          shouldStore: false;
          tokens: { token: string } | null;
          waitForHandshake: boolean;
          context: AuthFlowContext;
        },
  ): Promise<boolean> => {
    const { waitForHandshake, context, ...tokenArgs } = args;
    await setToken({
      ...(tokenArgs as
        | { shouldStore: true; tokens: AuthTokens | null }
        | { shouldStore: false; tokens: { token: string } | null }),
      requireHandshake: waitForHandshake,
    });
    if (tokenArgs.tokens === null) {
      return false;
    }
    if (waitForHandshake) {
      await waitForAuthHandshake(context);
    }
    return true;
  };

  const adapterDeps: ClientAdapterDeps = {
    proxy,
    convex,
    requireApiRefs,
    proxyFetch,
    setTokenAndMaybeWait,
  };
  const passkeyAdapter = adapters.passkey ?? services.adapterFactories.passkey?.(adapterDeps);

  // ---------------------------------------------------------------------------
  // Code verification with retries (SPA mode only)
  // ---------------------------------------------------------------------------

  const verifyCode = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    return retryWithJitteredBackoff(
      () =>
        requireHttpClient().action(
          requireApiRefs().signIn,
          "code" in args ? { params: { code: args.code }, verifier: args.verifier } : args,
        ) as Promise<SignInActionResult>,
      isTransientNetworkError,
    );
  };

  const verifyCodeAndSetToken = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
    opts?: { resyncConvexAuth?: boolean },
  ) => {
    const result = await verifyCode(args);
    if (result.kind !== "signedIn") {
      throw new Error("Code exchange did not return tokens.");
    }
    const { session } = result as Extract<SignInActionResult, { kind: "signedIn" }>;
    await setToken({
      shouldStore: true,
      tokens: (session as AuthTokens | null) ?? null,
      resyncConvexAuth: opts?.resyncConvexAuth,
    });
    return session !== null;
  };

  const normalizeDeviceCodeResult = (device_code: unknown): DeviceCodeResult => {
    const input = device_code as {
      deviceCode: string;
      userCode: string;
      verification_uri?: string;
      verificationUri?: string;
      verification_uri_complete?: string;
      verificationUriComplete?: string;
      expiresIn: number;
      interval: number;
    };
    return {
      deviceCode: input.deviceCode,
      userCode: input.userCode,
      verificationUri: input.verification_uri ?? input.verificationUri ?? "",
      verificationUriComplete:
        input.verification_uri_complete ?? input.verificationUriComplete ?? "",
      expiresIn: input.expiresIn,
      interval: input.interval,
    };
  };

  const isSignedInResult = (
    result: SignInActionResult,
  ): result is Extract<SignInActionResult, { kind: "signedIn" }> => result.kind === "signedIn";

  // ---------------------------------------------------------------------------
  // signIn
  // ---------------------------------------------------------------------------

  /**
   * Sign in with a provider.
   *
   * @param provider - Provider ID (e.g. `"email"`, `"password"`, `"google"`).
   *   Omit when exchanging an OAuth code (the code carries the provider info).
   * @param args - Provider-specific arguments. Pass a `Record<string, Value>`
   *   or `FormData`. Common fields: `email`, `password`, `code`, `redirectTo`.
   * @returns A {@link SignInResult} indicating the outcome.
   * @throws {ConvexError} When the server action rejects the sign-in attempt (e.g. invalid credentials, provider error, or rate limiting).
   *
   * @example Email magic link
   * ```ts
   * await auth.signIn('email', { email: 'user@example.com' });
   * ```
   *
   * @example Password
   * ```ts
   * const result = await auth.signIn('password', { email, password, flow: 'signIn' });
   * if (result.kind === 'totpRequired') {
   *   await auth.totp.verify({ code: totpCode, verifier: result.verifier });
   * }
   * ```
   *
   * @example OAuth (returns a redirect URL)
   * ```ts
   * const result = await auth.signIn('google');
   * if (result.kind === 'redirect') {
   *   window.location.href = result.redirect.toString();
   * }
   * ```
   */
  const signIn = async (
    provider?: string,
    args?: FormData | Record<string, Value>,
  ): Promise<SignInResult> => {
    // Persist invite before potential OAuth redirect
    await persistInvite();

    const params =
      args instanceof FormData
        ? (() => {
            const formParams: Record<string, Value> = {};
            for (const [key, value] of formDataEntries(args)) {
              formParams[key] = typeof value === "string" ? value : value.name;
            }
            return formParams;
          })()
        : (args ?? {});
    const flow = typeof params.flow === "string" && params.flow.length > 0 ? params.flow : "signIn";
    const signInKey = buildSignInRequestKey(provider, params);

    const handleSignInActionResult = async (
      result: SignInActionResult,
      resultOptions: { shouldStore: boolean; persistVerifier: boolean },
    ): Promise<SignInResult> => {
      if (result.kind === "redirect") {
        const redirectUrl = new URL(result.redirect);
        if (resultOptions.persistVerifier) {
          await storageSet(VERIFIER_STORAGE_KEY, result.verifier);
        }
        return {
          kind: "redirect" as const,
          redirect: redirectUrl,
          verifier: result.verifier,
        } satisfies SignInResult;
      }

      if (result.kind === "totpRequired") {
        return {
          kind: "totpRequired" as const,
          verifier: result.verifier,
        } satisfies SignInResult;
      }

      if (result.kind === "deviceCode") {
        return {
          kind: "deviceCode" as const,
          deviceCode: normalizeDeviceCodeResult(result.deviceCode),
        } satisfies SignInResult;
      }

      if (result.kind === "signedIn") {
        const signingIn = await setTokenAndMaybeWait(
          resultOptions.shouldStore
            ? {
                shouldStore: true as const,
                tokens: result.session,
                waitForHandshake: true,
                context: { provider, flow },
              }
            : {
                shouldStore: false as const,
                tokens: result.session === null ? null : { token: result.session.token },
                waitForHandshake: true,
                context: { provider, flow },
              },
        );
        return signingIn
          ? ({ kind: "signedIn" as const } satisfies SignInResult)
          : ({ kind: "started" as const } satisfies SignInResult);
      }

      // "started", "passkeyOptions", "totpSetup"
      return { kind: "started" as const } satisfies SignInResult;
    };

    if (activeSignIn !== null) {
      if (activeSignIn.key === signInKey) {
        return await activeSignIn.promise;
      }
      throw new Error("Another sign-in flow is already in progress.");
    }

    const signInPromise = (async () => {
      if (proxy) {
        const result = (await proxyFetch({
          action: "auth:signIn",
          args: { provider, params },
        })) as SignInActionResult;
        return await handleSignInActionResult(result, {
          shouldStore: false,
          persistVerifier: false,
        });
      }

      const verifier = (await storageGet(VERIFIER_STORAGE_KEY)) ?? undefined;
      try {
        const result = (await convex.action(requireApiRefs().signIn, {
          provider,
          params,
          verifier,
        })) as SignInActionResult;
        if (params.code !== undefined) {
          await storageRemove(VERIFIER_STORAGE_KEY);
        }
        return await handleSignInActionResult(result, {
          shouldStore: true,
          persistVerifier: true,
        });
      } catch (error) {
        if (params.code !== undefined) {
          const convexCode =
            error instanceof ConvexError && typeof error.data?.code === "string"
              ? error.data.code
              : null;
          if (convexCode !== null && ["INVALID_VERIFICATION_CODE", "INVALID_VERIFIER"].includes(convexCode)) {
            await storageRemove(VERIFIER_STORAGE_KEY);
          }
        }
        throw error;
      }
    })();

    activeSignIn = { key: signInKey, promise: signInPromise };
    try {
      return await signInPromise;
    } finally {
      if (activeSignIn?.promise === signInPromise) {
        activeSignIn = null;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------

  /**
   * Sign out the current user.
   *
   * Invalidates the server session and clears local token state.
   * Errors are silently caught — calling `signOut` on an already
   * signed-out user is a no-op.
   */
  const signOut = async () => {
    if (proxy) {
      try {
        await proxyFetch({ action: "auth:signOut", args: {} });
      } catch {
        // Ignore sign-out errors
      }
      await setToken({ shouldStore: false, tokens: null });
      if (convex.clearAuth) convex.clearAuth();
      return;
    }

    try {
      await convex.action(requireApiRefs().signOut, {});
    } catch {
      // Ignore sign-out errors
    }
    await setToken({ shouldStore: true, tokens: null });
    if (convex.clearAuth) convex.clearAuth();
  };

  // ---------------------------------------------------------------------------
  // fetchAccessToken — called by convex.setAuth()
  // ---------------------------------------------------------------------------

  const fetchAccessToken = async ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean;
  }): Promise<string | null> => {
    if (!forceRefreshToken) return token;

    const mutex = runtime.mutex;
    const withMutex = mutex
      ? <T>(key: string, callback: () => Promise<T>) => mutex.withKey(key, callback)
      : localMutex;

    if (proxy) {
      const tokenBeforeRefresh = token;
      return await withMutex(`__convexAuthProxyRefresh_${escapedNamespace}`, async () => {
        // Another tab/call may have already refreshed.
        if (token !== tokenBeforeRefresh) return token;

        try {
          const result = await retryWithJitteredBackoff(
            () =>
              proxyFetch({
                action: "auth:signIn",
                args: { refreshToken: true },
              }) as Promise<SignInActionResult>,
            isRetriableProxyRefreshError,
          );
          if (isSignedInResult(result) && result.session) {
            await setToken({
              shouldStore: false,
              tokens: { token: result.session.token },
              resyncConvexAuth: false,
            });
          } else {
            await setToken({
              shouldStore: false,
              tokens: null,
              resyncConvexAuth: false,
            });
          }
        } catch (error) {
          logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
            "[convex-auth] Proxy refresh failed:",
            error,
          ]);
          if (token === null) {
            finalizeLoadingState();
          }
        }
        return token;
      });
    }

    // Direct mode: refresh via storage + httpClient.
    const tokenBeforeLockAcquisition = token;
    return await withMutex(key(REFRESH_TOKEN_STORAGE_KEY), async () => {
      const tokenAfterLockAcquisition = token;
      if (tokenAfterLockAcquisition !== tokenBeforeLockAcquisition) {
        return tokenAfterLockAcquisition;
      }
      const refreshToken = (await storageGet(REFRESH_TOKEN_STORAGE_KEY)) ?? null;
      if (!refreshToken) {
        await setToken({ shouldStore: true, tokens: null, resyncConvexAuth: false });
        return null;
      }
      await verifyCodeAndSetToken({ refreshToken }, { resyncConvexAuth: false });
      return token;
    });
  };

  // ---------------------------------------------------------------------------
  // OAuth code flow (SPA mode only — server handles this in proxy mode)
  // ---------------------------------------------------------------------------

  const resolveOAuthInput = (input: URL | string | { code: string }) => {
    if (input instanceof URL) {
      return {
        code: input.searchParams.get("code"),
        cleanupUrl: input.searchParams.has("code")
          ? (() => {
              const next = new URL(input.toString());
              next.searchParams.delete("code");
              return next;
            })()
          : null,
      };
    }
    if (typeof input === "object") {
      return { code: input.code, cleanupUrl: null };
    }
    try {
      const url = new URL(input);
      return {
        code: url.searchParams.get("code"),
        cleanupUrl: url.searchParams.has("code")
          ? (() => {
              const next = new URL(url.toString());
              next.searchParams.delete("code");
              return next;
            })()
          : null,
      };
    } catch {
      return { code: input, cleanupUrl: null };
    }
  };

  const completeOAuth = async (
    input: URL | string | { code: string },
  ): Promise<OAuthCompletionResult> => {
    const { code, cleanupUrl } = resolveOAuthInput(input);
    if (!code) {
      return { handled: false };
    }
    const result = await signIn(undefined, { code });
    if (result.kind !== "signedIn") {
      throw new Error("OAuth code exchange did not complete sign-in.");
    }
    return { handled: true, cleanupUrl };
  };

  // ---------------------------------------------------------------------------
  // Hydrate from storage (SPA mode only)
  // ---------------------------------------------------------------------------

  const hydrateFromStorage = async () => {
    const storedToken = (await storageGet(JWT_STORAGE_KEY)) ?? null;
    await setToken({
      shouldStore: false,
      tokens: storedToken === null ? null : { token: storedToken },
      resyncConvexAuth: storedToken !== null,
    });
  };

  const initialize = async (): Promise<void> => {
    if (initializePromise !== null) {
      return await initializePromise;
    }

    initializePromise = (async () => {
      if (proxy) {
        if (!hasServerToken && runtime.environment !== "server") {
          try {
            await fetchAccessToken({ forceRefreshToken: true });
          } catch (error) {
            logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
              "[convex-auth] Proxy token refresh failed:",
              error,
            ]);
          }
        }
        return;
      }

      try {
        await hydrateFromStorage();
      } catch {
        try {
          await setToken({ shouldStore: false, tokens: null, resyncConvexAuth: false });
        } catch {
          // Ignore cleanup errors
        }
      }
    })();

    try {
      await initializePromise;
    } finally {
      initializePromise = Promise.resolve();
    }
  };

  // ---------------------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to auth state changes. Invokes the callback immediately
   * with the current state, then again on every state transition.
   *
   * ```ts
   * const unsub = auth.onChange(setState);
   * ```
   *
   * @param cb - Callback receiving the latest {@link AuthState}.
   * @returns An unsubscribe function.
   */
  const onChange = (cb: (state: AuthState) => void): (() => void) => {
    cb(snapshot);
    const wrapped = () => cb(snapshot);
    subscribers.add(wrapped);
    return () => {
      subscribers.delete(wrapped);
    };
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  // Cross-tab sync via storage events (SPA mode only).
  if (!proxy && runtime.sync) {
    disposeStorageListener =
      runtime.sync.subscribe(key(JWT_STORAGE_KEY), (value) => {
        void setToken({
          shouldStore: false,
          tokens: value === null ? null : { token: value },
        }).catch((error) => {
          logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
            "[convex-auth] Storage event handler failed:",
            error,
          ]);
        });
      }) ?? null;
  }

  // Auto-wire: feed our tokens into the Convex client so
  // queries and mutations are automatically authenticated.
  bindConvexAuth();

  void initialize().catch((error) => {
    logMessage("convex-auth/client", LOG_LEVELS.ERROR, [
      "[convex-auth] Client initialization failed:",
      error,
    ]);
  });

  // ---------------------------------------------------------------------------
  // Auth factor helpers
  // ---------------------------------------------------------------------------

  const totp =
    adapters.totp ??
    createTotpClient({
      proxy,
      convex,
      requireApiRefs,
      proxyFetch,
      setTokenAndMaybeWait,
    });

  const device =
    adapters.device ??
    createDeviceClient({
      proxy,
      convex,
      requireApiRefs,
      proxyFetch,
      setTokenAndMaybeWait,
    });

  return {
    /** Current auth state snapshot. */
    get state(): AuthState {
      return snapshot;
    },
    /** Restore persisted auth state for the current runtime. */
    initialize,
    /** SSR-safe URL param reader. */
    param,
    /** Pending invite from URL or recovered from storage. Null if none. */
    get invite(): PendingInvite | null {
      const pendingInvite = getPendingInvite();
      if (!pendingInvite) return null;
      return {
        token: pendingInvite.token,
        email: pendingInvite.email,
        accept: acceptInvite,
      };
    },
    /** Complete an OAuth callback from a URL or authorization code. */
    completeOAuth,
    /** Sign in with a provider. See {@link SignInResult} for return shape. */
    signIn,
    /** Sign out and clear all token state. */
    signOut,
    /** Subscribe to auth state changes. Returns an unsubscribe function. */
    onChange,
    /** TOTP two-factor authentication helpers. */
    totp,
    /** Device authorization (RFC 8628) helpers. */
    device,
    /**
     * Tear down this auth client instance.
     *
     * Removes the cross-tab `storage` event listener, clears all
     * `onChange` subscribers, and rejects any in-flight handshake
     * waiters. Call this when the client is no longer needed
     * (e.g. on SPA unmount or hot-module replacement) to prevent
     * memory leaks and stale callbacks.
     *
     * @example
     * ```ts
     * // SvelteKit onDestroy
     * import { onDestroy } from "svelte";
     * const auth = client({ convex, api: api.auth });
     * onDestroy(() => auth.destroy());
     * ```
     *
     * @example
     * ```ts
     * const unsubscribe = auth.onChange((state) => console.log(state.phase));
     *
     * // Later, during cleanup:
     * unsubscribe();
     * auth.destroy();
     * ```
     */
    destroy: () => {
      destroyed = true;
      settleHandshakeWaiters(authEpoch, {
        type: "reject",
        error: createHandshakeError("AUTH_HANDSHAKE_REJECTED", {
          reason: "destroyed",
        }),
      });
      disposeStorageListener?.();
      subscribers.clear();
    },
    ...(passkeyAdapter ? { passkey: passkeyAdapter } : {}),
  } as AuthClient<Api>;
}
