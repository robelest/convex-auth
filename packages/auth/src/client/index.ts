import { Fx } from "@robelest/fx";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError, Value } from "convex/values";

import { AUTH_ERRORS } from "../server/errors";
import { browserMutex, getStorageListenerRegistry } from "./runtime/browser";
import { createDeviceClient } from "./factors/device";
import { createInviteManager } from "./runtime/invite";
import { createPasskeyClient } from "./factors/passkey";
import {
  createProxyHelpers,
  isRetriableProxyRefreshError,
  isTransientNetworkError,
} from "./runtime/proxy";
import { createStorageHelpers } from "./runtime/storage";
import { createTotpClient } from "./factors/totp";
import type {
  AuthApiRefs,
  AuthClient,
  AuthFlowContext,
  AuthHandshakeErrorCode,
  AuthSession,
  AuthState,
  ClientOptions,
  ConvexTransport,
  DeviceClient,
  DeviceCodeResult,
  HandshakeWaiter,
  PasskeyClient,
  PendingInvite,
  SignInActionResult,
  SignInResult,
  Storage,
  TotpClient,
} from "./core/types";

// Re-export error utilities so consumers can import from `@robelest/convex-auth/client`.
export {
  isAuthError,
  parseAuthError,
  AUTH_ERRORS,
  type AuthErrorCode,
} from "../server/errors";
export type {
  AuthApiRefs,
  AuthClient,
  AuthState,
  ClientOptions,
  DeviceClient,
  DeviceCodeResult,
  PasskeyClient,
  PendingInvite,
  SignInResult,
  Storage,
  TotpClient,
} from "./core/types";

const VERIFIER_STORAGE_KEY = "__convexAuthOAuthVerifier";
const JWT_STORAGE_KEY = "__convexAuthJWT";
const REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken";
const INVITE_TOKEN_KEY = "__convexAuthPendingInvite";
const INVITE_EMAIL_KEY = "__convexAuthPendingInviteEmail";

const RETRY_BASE_MS = 500;
const RETRY_MAX_RETRIES = 2;
const AUTH_HANDSHAKE_TIMEOUT_MS = 5000;

/**
 * Resolve the Convex deployment URL from the client.
 *
 * `ConvexReactClient` exposes `.url` directly.
 * `ConvexClient` exposes `.client.url` via `BaseConvexClient`.
 */
function resolveUrl(convex: ConvexTransport, explicit?: string): string {
  if (explicit) return explicit;
  const c = convex as any;
  const url: unknown = c.url ?? c.client?.url;
  if (typeof url === "string") return url;
  throw new Error(
    "Could not determine Convex deployment URL. Pass `url` explicitly.",
  );
}

/**
 * Create a framework-agnostic auth client.
 *
 * Returns an object with `signIn`, `signOut`, `onChange`, `state`,
 * `passkey`, and `totp` — everything needed for client-side auth.
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
 * ### SSR / proxy mode
 *
 * ```ts
 * const auth = client({
 *   convex,
 *   proxyPath: '/api/auth',
 *   tokenSeed: tokenFromServer, // JWT read from httpOnly cookie during SSR
 * });
 * ```
 *
 * In proxy mode all auth operations go through the proxy URL.
 * Tokens are stored in httpOnly cookies server-side — the client
 * holds the JWT in memory only.
 *
 * @param options - Client configuration. See {@link ClientOptions}.
 * @typeParam Api - An AuthApiRefs type determining which factor helpers are available.
 * @returns Auth client with conditional `passkey`, `totp`, and `device` helpers.
 * @throws {Error} When the Convex deployment URL cannot be determined and `url` is not passed explicitly.
 * @throws {Error} When `proxyPath` is not set and the `api` option is missing.
 */
export function client<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
>(options: ClientOptions<Api>): AuthClient<Api> {
  const { convex, proxyPath, api: apiRefs } = options;
  const proxy = proxyPath;

  function requireApiRefs() {
    if (!apiRefs) {
      throw new Error(
        "The `api` option is required when `proxyPath` is not set. " +
          "Pass { api: api.auth }.",
      );
    }
    return apiRefs;
  }

  // In proxy mode, default storage to null (cookies handle persistence).
  const storage =
    options.storage !== undefined
      ? options.storage
      : proxy
        ? null
        : typeof window === "undefined"
          ? null
          : window.localStorage;

  const replaceUrl =
    options.replaceUrl ??
    ((url: string) => {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", url);
      }
    });

  // ---------------------------------------------------------------------------
  // Location — SSR-safe URL reading
  // ---------------------------------------------------------------------------

  function getLocation(): URL | null {
    if (typeof options.location === "function") return options.location();
    if (options.location instanceof URL) return options.location;
    if (typeof window !== "undefined") return new URL(window.location.href);
    return null;
  }

  /**
   * SSR-safe URL parameter reader.
   *
   * Uses the `location` option if provided, otherwise falls back to
   * `window.location` (returns `null` during SSR where `window` is unavailable).
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
    const searchParams = new URLSearchParams(loc.search);
    let changed = false;
    for (const p of params) {
      if (searchParams.has(p)) {
        searchParams.delete(p);
        changed = true;
      }
    }
    if (changed) {
      const next = searchParams.toString()
        ? `${loc.pathname}?${searchParams}`
        : loc.pathname;
      void replaceUrl(next);
    }
  }

  const url = proxy ? undefined : resolveUrl(convex, options.url);
  const escapedNamespace = proxy
    ? proxy.replace(/[^a-zA-Z0-9]/g, "")
    : url!.replace(/[^a-zA-Z0-9]/g, "");
  const key = (name: string) => `${name}_${escapedNamespace}`;
  const {
    get: storageGet,
    set: storageSet,
    remove: storageRemove,
  } = createStorageHelpers({ storage, key });
  const { isAbsoluteUrl, proxyFetch, resolveProxyUrl } = createProxyHelpers({
    proxy,
  });
  const subscribers = new Set<() => void>();
  let disposeStorageListener: (() => void) | null = null;

  // Unauthenticated HTTP client for code verification & OAuth exchange.
  // Only needed in SPA mode — proxy mode routes everything through the proxy.
  const httpClient = proxy ? null : new ConvexHttpClient(url!);

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
  const handshakeWaiters = new Set<HandshakeWaiter>();
  let snapshot: AuthState = {
    phase: hasServerToken
      ? "authenticated"
      : isLoading
        ? "loading"
        : "unauthenticated",
    isLoading,
    isAuthenticated: hasServerToken,
    token,
  };
  let handlingCodeFlow = false;

  const createHandshakeError = (
    code: AuthHandshakeErrorCode,
    context: Record<string, unknown>,
  ) => {
    return new ConvexError({
      code,
      message: AUTH_ERRORS[code],
      ...context,
    } as Value);
  };

  const settleHandshakeWaiters = (
    epoch: number,
    outcome:
      | { type: "resolve" }
      | { type: "reject"; error: ConvexError<Value> },
  ) => {
    for (const waiter of Array.from(handshakeWaiters)) {
      if (waiter.epoch !== epoch) {
        continue;
      }
      clearTimeout(waiter.timeoutId);
      handshakeWaiters.delete(waiter);
      if (outcome.type === "resolve") {
        waiter.resolve();
      } else {
        waiter.reject(outcome.error);
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
      waiter.reject(
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
    await new Promise<void>((resolve, reject) => {
      const waiterRef: { current: HandshakeWaiter | null } = { current: null };
      const timeoutId = setTimeout(() => {
        if (waiterRef.current !== null) {
          handshakeWaiters.delete(waiterRef.current);
        }
        reject(
          createHandshakeError("AUTH_HANDSHAKE_TIMEOUT", {
            ...context,
            timeoutMs: AUTH_HANDSHAKE_TIMEOUT_MS,
          }),
        );
      }, AUTH_HANDSHAKE_TIMEOUT_MS);

      const waiter: HandshakeWaiter = {
        epoch,
        context,
        resolve,
        reject,
        timeoutId,
      };
      waiterRef.current = waiter;
      handshakeWaiters.add(waiter);
    });
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
    const phaseDispatch = {
      tag:
        token !== null && handshakePending
          ? "handshake"
          : isLoading
            ? "loading"
            : token !== null && authConfirmed
              ? "authenticated"
              : "unauthenticated",
    } as const;

    const phase = {
      handshake: "handshake",
      loading: "loading",
      authenticated: "authenticated",
      unauthenticated: "unauthenticated",
    }[phaseDispatch.tag] as AuthState["phase"];

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
          tokens: AuthSession | null;
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
      const shouldEnterHandshake =
        args.requireHandshake === true || !authConfirmed;
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
          tokens: AuthSession | null;
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
        | { shouldStore: true; tokens: AuthSession | null }
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

  // ---------------------------------------------------------------------------
  // Code verification with retries (SPA mode only)
  // ---------------------------------------------------------------------------

  const verifyCode = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    const verifyCodeRetryPolicy = Fx.retry.while(
      Fx.retry.compose(
        Fx.retry.jittered(Fx.retry.exponential(RETRY_BASE_MS)),
        Fx.retry.recurs(RETRY_MAX_RETRIES),
      ),
      (meta) => isTransientNetworkError(meta.input),
    );

    return Fx.run(
      Fx.from({
        ok: () =>
          httpClient!.action(
            requireApiRefs().signIn,
            "code" in args
              ? { params: { code: args.code }, verifier: args.verifier }
              : args,
          ),
        err: (e) => e,
      }).pipe(
        Fx.retry(verifyCodeRetryPolicy),
        Fx.recover((e) => Fx.fatal(e)),
      ),
    );
  };

  const verifyCodeAndSetToken = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
    opts?: { resyncConvexAuth?: boolean },
  ) => {
    const { tokens } = await verifyCode(args);
    await setToken({
      shouldStore: true,
      tokens: (tokens as AuthSession | null) ?? null,
      resyncConvexAuth: opts?.resyncConvexAuth,
    });
    return tokens !== null;
  };

  const normalizeDeviceCodeResult = (device_code: any): DeviceCodeResult => {
    return {
      deviceCode: device_code.deviceCode,
      userCode: device_code.userCode,
      verificationUri:
        device_code.verification_uri ?? device_code.verificationUri,
      verificationUriComplete:
        device_code.verification_uri_complete ??
        device_code.verificationUriComplete,
      expiresIn: device_code.expiresIn,
      interval: device_code.interval,
    };
  };

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
   * @example OAuth (triggers redirect)
   * ```ts
   * await auth.signIn('google'); // redirects to Google
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
            args.forEach((value, key) => {
              formParams[key] = typeof value === "string" ? value : value.name;
            });
            return formParams;
          })()
        : (args ?? {});
    const flow =
      typeof params.flow === "string" && params.flow.length > 0
        ? params.flow
        : "signIn";

    const handleSignInActionResult = async (
      result: SignInActionResult,
      options: { shouldStore: boolean; persistVerifier: boolean },
    ): Promise<SignInResult> =>
      Fx.run(
        Fx.match(result, result.kind, {
          redirect: (redirectResult) =>
            Fx.from({
              ok: async () => {
                const redirectUrl = new URL(redirectResult.redirect);
                if (options.persistVerifier) {
                  await storageSet(
                    VERIFIER_STORAGE_KEY,
                    redirectResult.verifier,
                  );
                }
                if (typeof window !== "undefined") {
                  window.location.href = redirectUrl.toString();
                }
                return {
                  kind: "redirect" as const,
                  redirect: redirectUrl,
                  verifier: redirectResult.verifier,
                };
              },
              err: (e) => e as never,
            }),
          totpRequired: (totpRequiredResult) =>
            Fx.succeed({
              kind: "totpRequired" as const,
              verifier: totpRequiredResult.verifier,
            }),
          deviceCode: (deviceCodeResult) =>
            Fx.succeed({
              kind: "deviceCode" as const,
              deviceCode: normalizeDeviceCodeResult(
                deviceCodeResult.deviceCode,
              ),
            }),
          signedIn: (signedInResult) =>
            Fx.from({
              ok: async () => {
                const signingIn = await setTokenAndMaybeWait(
                  options.shouldStore
                    ? {
                        shouldStore: true as const,
                        tokens: signedInResult.tokens,
                        waitForHandshake: true,
                        context: { provider, flow },
                      }
                    : {
                        shouldStore: false as const,
                        tokens:
                          signedInResult.tokens === null
                            ? null
                            : { token: signedInResult.tokens.token },
                        waitForHandshake: true,
                        context: { provider, flow },
                      },
                );
                return signingIn
                  ? ({ kind: "signedIn" as const } as SignInResult)
                  : ({ kind: "started" as const } as SignInResult);
              },
              err: (e) => e as never,
            }),
          started: (_startedResult) => Fx.succeed({ kind: "started" as const }),
          passkeyOptions: (_passkeyOptionsResult) =>
            Fx.succeed({ kind: "started" as const }),
          totpSetup: (_totpSetupResult) =>
            Fx.succeed({ kind: "started" as const }),
        }),
      );

    if (proxy) {
      const result = (await proxyFetch({
        action: "auth:signIn",
        args: { provider, params },
      })) as SignInActionResult;
      return handleSignInActionResult(result, {
        shouldStore: false,
        persistVerifier: false,
      });
    }

    // SPA mode: call Convex directly.
    const verifier = (await storageGet(VERIFIER_STORAGE_KEY)) ?? undefined;
    await storageRemove(VERIFIER_STORAGE_KEY);
    const result = (await convex.action(requireApiRefs().signIn, {
      provider,
      params,
      verifier,
    })) as SignInActionResult;
    return handleSignInActionResult(result, {
      shouldStore: true,
      persistVerifier: true,
    });
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
      await Fx.run(
        Fx.from({
          ok: () => proxyFetch({ action: "auth:signOut", args: {} }),
          err: () => undefined,
        }).pipe(Fx.recover(() => Fx.succeed(undefined))),
      );
      await setToken({ shouldStore: false, tokens: null });
      if (convex.clearAuth) convex.clearAuth();
      return;
    }

    // SPA mode.
    await Fx.run(
      Fx.from({
        ok: () => convex.action(requireApiRefs().signOut, {}),
        err: () => undefined,
      }).pipe(Fx.recover(() => Fx.succeed(undefined))),
    );
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

    if (proxy) {
      // Proxy mode: POST to the proxy to refresh.
      // The proxy reads the real refresh token from the httpOnly cookie.
      const resolvedProxyUrl = await resolveProxyUrl();
      if (
        typeof window === "undefined" &&
        !(await isAbsoluteUrl(resolvedProxyUrl))
      ) {
        finalizeLoadingState();
        return token;
      }

      const tokenBeforeRefresh = token;
      return await browserMutex("__convexAuthProxyRefresh", async () => {
        // Another tab/call may have already refreshed.
        if (token !== tokenBeforeRefresh) return token;

        const proxyRefreshRetryPolicy = Fx.retry.while(
          Fx.retry.compose(
            Fx.retry.jittered(Fx.retry.exponential(RETRY_BASE_MS)),
            Fx.retry.recurs(RETRY_MAX_RETRIES),
          ),
          (meta) => isRetriableProxyRefreshError(meta.input),
        );

        await Fx.run(
          Fx.from({
            ok: () =>
              proxyFetch({
                action: "auth:signIn",
                args: { refreshToken: true },
              }),
            err: (e) => e,
          }).pipe(
            Fx.retry(proxyRefreshRetryPolicy),
            Fx.chain((result: any) =>
              Fx.from({
                ok: async () => {
                  if (result.tokens) {
                    await setToken({
                      shouldStore: false,
                      tokens: { token: result.tokens.token },
                      resyncConvexAuth: false,
                    });
                  } else {
                    await setToken({
                      shouldStore: false,
                      tokens: null,
                      resyncConvexAuth: false,
                    });
                  }
                },
                err: (e) => e,
              }),
            ),
            Fx.inspect((error) =>
              Fx.sync(() =>
                console.error("[convex-auth] Proxy refresh failed:", error),
              ),
            ),
            Fx.recover(() => {
              if (token === null) {
                finalizeLoadingState();
              }
              return Fx.succeed(undefined);
            }),
          ),
        );
        return token;
      });
    }

    // SPA mode: refresh via localStorage + httpClient.
    const tokenBeforeLockAcquisition = token;
    return await browserMutex(REFRESH_TOKEN_STORAGE_KEY, async () => {
      const tokenAfterLockAcquisition = token;
      if (tokenAfterLockAcquisition !== tokenBeforeLockAcquisition) {
        return tokenAfterLockAcquisition;
      }
      const refreshToken =
        (await storageGet(REFRESH_TOKEN_STORAGE_KEY)) ?? null;
      if (!refreshToken) {
        finalizeLoadingState();
        return null;
      }
      await verifyCodeAndSetToken(
        { refreshToken },
        { resyncConvexAuth: false },
      );
      return token;
    });
  };

  // ---------------------------------------------------------------------------
  // OAuth code flow (SPA mode only — server handles this in proxy mode)
  // ---------------------------------------------------------------------------

  const handleCodeFlow = async () => {
    if (typeof window === "undefined") return;
    if (handlingCodeFlow) return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    handlingCodeFlow = true;
    await Fx.run(
      Fx.from({
        ok: async () => {
          await signIn(undefined, { code });
          const codeUrl = new URL(window.location.href);
          codeUrl.searchParams.delete("code");
          await replaceUrl(codeUrl.pathname + codeUrl.search + codeUrl.hash);
        },
        err: (e) => e,
      }).pipe(
        Fx.recover(() => Fx.succeed(undefined)),
        Fx.tap(() =>
          Fx.sync(() => {
            handlingCodeFlow = false;
          }),
        ),
        Fx.inspect(() =>
          Fx.sync(() => {
            handlingCodeFlow = false;
          }),
        ),
      ),
    );
    // The flag is always reset — Fx.recover above ensures success path,
    // but reset defensively here too.
    handlingCodeFlow = false;
  };

  // ---------------------------------------------------------------------------
  // Hydrate from storage (SPA mode only)
  // ---------------------------------------------------------------------------

  const hydrateFromStorage = async () => {
    const storedToken = (await storageGet(JWT_STORAGE_KEY)) ?? null;
    await setToken({
      shouldStore: false,
      tokens: storedToken === null ? null : { token: storedToken },
    });
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
  if (!proxy && typeof window !== "undefined") {
    const registryKey = key(JWT_STORAGE_KEY);
    const registry = getStorageListenerRegistry();
    const existingListener = registry[registryKey];
    if (existingListener !== undefined) {
      window.removeEventListener("storage", existingListener);
    }

    const onStorage = (event: StorageEvent) => {
      Fx.detach(async () => {
        if (event.key !== key(JWT_STORAGE_KEY)) return;
        await setToken({
          shouldStore: false,
          tokens: event.newValue === null ? null : { token: event.newValue },
        });
      }, "[convex-auth] Storage event handler failed:");
    };
    window.addEventListener("storage", onStorage);
    registry[registryKey] = onStorage;
    disposeStorageListener = () => {
      if (registry[registryKey] === onStorage) {
        delete registry[registryKey];
      }
      window.removeEventListener("storage", onStorage);
    };
  }

  // Auto-wire: feed our tokens into the Convex client so
  // queries and mutations are automatically authenticated.
  bindConvexAuth();

  // Auto-hydrate and handle code flow.
  if (typeof window !== "undefined") {
    if (proxy) {
      // Proxy mode: eagerly resolve auth once on startup so routes that only
      // read auth state (and do not issue Convex queries yet) don't stay in
      // the initial loading phase.
      if (!hasServerToken) {
        Fx.detach(
          () => fetchAccessToken({ forceRefreshToken: true }),
          "[convex-auth] Proxy token refresh failed:",
        );
      }
    } else {
      // SPA mode: hydrate from localStorage, then handle OAuth code flow.
      Fx.detach(async () => {
        await Fx.run(
          Fx.from({
            ok: async () => {
              await hydrateFromStorage();
              await handleCodeFlow();
            },
            err: (e) => e,
          }).pipe(
            Fx.inspect((error) =>
              Fx.sync(() =>
                console.error(
                  "[convex-auth] Client initialization failed:",
                  error,
                ),
              ),
            ),
            Fx.recover((_error) =>
              Fx.from({
                ok: () => setToken({ shouldStore: false, tokens: null }),
                err: (e) => e,
              }).pipe(Fx.recover(() => Fx.succeed(undefined))),
            ),
          ),
        );
      }, "[convex-auth] SPA initialization failed:");
    }
  }

  // ---------------------------------------------------------------------------
  // Auth factor helpers
  // ---------------------------------------------------------------------------

  const passkey = createPasskeyClient({
    proxy,
    convex,
    requireApiRefs,
    proxyFetch,
    setTokenAndMaybeWait,
  });

  const totp = createTotpClient({
    proxy,
    convex,
    requireApiRefs,
    proxyFetch,
    setTokenAndMaybeWait,
  });

  const device = createDeviceClient({
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
    /** Sign in with a provider. See {@link SignInResult} for return shape. */
    signIn,
    /** Sign out and clear all token state. */
    signOut,
    /** Subscribe to auth state changes. Returns an unsubscribe function. */
    onChange,
    /** Passkey (WebAuthn) authentication helpers. */
    passkey,
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
  } as AuthClient<Api>;
}
