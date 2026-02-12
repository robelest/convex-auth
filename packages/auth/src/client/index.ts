import { ConvexHttpClient } from "convex/browser";
import { Value } from "convex/values";

/**
 * Structural interface for any Convex client.
 * Satisfied by both `ConvexClient` (`convex/browser`) and
 * `ConvexReactClient` (`convex/react`).
 */
interface ConvexTransport {
  action(action: any, args: any): Promise<any>;
  setAuth(
    fetchToken: (args: {
      forceRefreshToken: boolean;
    }) => Promise<string | null | undefined>,
    onChange?: (isAuthenticated: boolean) => void,
  ): void;
  clearAuth(): void;
}

/** Pluggable key-value storage (defaults to `localStorage`). */
export interface Storage {
  getItem(
    key: string,
  ): string | null | undefined | Promise<string | null | undefined>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

type AuthSession = {
  token: string;
  refreshToken: string;
};

type SignInResult = {
  signingIn: boolean;
  redirect?: URL;
};

/** Reactive auth state snapshot returned by `auth.state` and `auth.onChange`. */
export type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  token: string | null;
};

/** Options for {@link client}. */
export type ClientOptions = {
  /** Any Convex client (`ConvexClient` or `ConvexReactClient`). */
  convex: ConvexTransport;
  /**
   * Convex deployment URL. Derived automatically from the client internals
   * when omitted — pass explicitly only if auto-detection fails.
   */
  url?: string;
  /**
   * Key-value storage for persisting tokens.
   *
   * - Defaults to `localStorage` in SPA mode.
   * - Defaults to `null` (in-memory only) when `proxy` is set,
   *   since httpOnly cookies handle persistence.
   */
  storage?: Storage | null;
  /** Override how the URL bar is updated after OAuth code exchange. */
  replaceURL?: (relativeUrl: string) => void | Promise<void>;
  /**
   * SSR proxy endpoint (e.g. `"/api/auth"`).
   *
   * When set, `signIn`/`signOut`/token refresh POST to this URL
   * (with `credentials: "include"`) instead of calling Convex directly.
   * The server handles httpOnly cookies for token persistence.
   *
   * Pair with {@link ClientOptions.token} for flash-free SSR hydration.
   */
  proxy?: string;
  /**
   * JWT from server-side hydration.
   *
   * In proxy mode the server reads the JWT from an httpOnly cookie
   * and passes it to the client during SSR. This avoids a loading
   * flash on first render — the client is immediately authenticated.
   */
  token?: string | null;
};

const VERIFIER_STORAGE_KEY = "__convexAuthOAuthVerifier";
const JWT_STORAGE_KEY = "__convexAuthJWT";
const REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken";

const RETRY_BACKOFF = [500, 2000];
const RETRY_JITTER = 100;

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
 * ### SPA mode (default)
 *
 * ```ts
 * import { ConvexClient } from 'convex/browser'
 * import { client } from '\@robelest/convex-auth/client'
 *
 * const convex = new ConvexClient(CONVEX_URL)
 * const auth = client({ convex })
 * ```
 *
 * ### SSR / proxy mode
 *
 * ```ts
 * const auth = client({
 *   convex,
 *   proxy: '/api/auth',
 *   initialToken: tokenFromServer, // read from httpOnly cookie during SSR
 * })
 * ```
 *
 * In proxy mode all auth operations go through the proxy URL.
 * Tokens are stored in httpOnly cookies server-side — the client
 * only holds the JWT in memory.
 */
export function client(options: ClientOptions) {
  const { convex, proxy } = options;

  // In proxy mode, default storage to null (cookies handle persistence).
  const storage =
    options.storage !== undefined
      ? options.storage
      : proxy
        ? null
        : typeof window === "undefined"
          ? null
          : window.localStorage;

  const replaceURL =
    options.replaceURL ??
    ((url: string) => {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", url);
      }
    });

  const url = proxy ? undefined : resolveUrl(convex, options.url);
  const escapedNamespace = proxy
    ? proxy.replace(/[^a-zA-Z0-9]/g, "")
    : url!.replace(/[^a-zA-Z0-9]/g, "");
  const key = (name: string) => `${name}_${escapedNamespace}`;
  const subscribers = new Set<() => void>();

  // Unauthenticated HTTP client for code verification & OAuth exchange.
  // Only needed in SPA mode — proxy mode routes everything through the proxy.
  const httpClient = proxy ? null : new ConvexHttpClient(url!);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  // If a server-provided token was supplied (SSR hydration), start authenticated.
  const serverToken = options.token ?? null;
  const hasServerToken = serverToken !== null;

  let token: string | null = serverToken;
  let isLoading = !hasServerToken;
  let snapshot: AuthState = {
    isLoading,
    isAuthenticated: hasServerToken,
    token,
  };
  let handlingCodeFlow = false;

  const notify = () => {
    for (const cb of subscribers) cb();
  };

  const updateSnapshot = () => {
    const next: AuthState = {
      isLoading,
      isAuthenticated: token !== null,
      token,
    };
    if (
      snapshot.isLoading === next.isLoading &&
      snapshot.isAuthenticated === next.isAuthenticated &&
      snapshot.token === next.token
    ) {
      return false;
    }
    snapshot = next;
    return true;
  };

  // ---------------------------------------------------------------------------
  // Storage helpers (SPA mode only)
  // ---------------------------------------------------------------------------

  const storageGet = async (name: string) =>
    storage ? ((await storage.getItem(key(name))) ?? null) : null;
  const storageSet = async (name: string, value: string) => {
    if (storage) await storage.setItem(key(name), value);
  };
  const storageRemove = async (name: string) => {
    if (storage) await storage.removeItem(key(name));
  };

  // ---------------------------------------------------------------------------
  // Token management
  // ---------------------------------------------------------------------------

  const setToken = async (
    args:
      | { shouldStore: true; tokens: AuthSession | null }
      | { shouldStore: false; tokens: { token: string } | null },
  ) => {
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
    const hadPendingLoad = isLoading;
    isLoading = false;
    const changed = updateSnapshot();
    if (hadPendingLoad || changed) {
      notify();
    }
  };

  // ---------------------------------------------------------------------------
  // Proxy fetch helper
  // ---------------------------------------------------------------------------

  const proxyFetch = async (body: Record<string, unknown>) => {
    const response = await fetch(proxy!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as any).error ?? `Proxy request failed: ${response.status}`,
      );
    }
    return response.json();
  };

  // ---------------------------------------------------------------------------
  // Code verification with retries (SPA mode only)
  // ---------------------------------------------------------------------------

  const verifyCode = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    let lastError: unknown;
    let retry = 0;
    while (retry < RETRY_BACKOFF.length) {
      try {
        return await httpClient!.action(
          "auth:signIn" as any,
          "code" in args
            ? { params: { code: args.code }, verifier: args.verifier }
            : args,
        );
      } catch (e) {
        lastError = e;
        const isNetworkError =
          e instanceof Error && /network/i.test(e.message || "");
        if (!isNetworkError) break;
        const wait = RETRY_BACKOFF[retry]! + RETRY_JITTER * Math.random();
        retry++;
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastError;
  };

  const verifyCodeAndSetToken = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    const { tokens } = await verifyCode(args);
    await setToken({
      shouldStore: true,
      tokens: (tokens as AuthSession | null) ?? null,
    });
    return tokens !== null;
  };

  // ---------------------------------------------------------------------------
  // signIn
  // ---------------------------------------------------------------------------

  const signIn = async (
    provider?: string,
    args?: FormData | Record<string, Value>,
  ): Promise<SignInResult> => {
    const params =
      args instanceof FormData
        ? Array.from(args.entries()).reduce(
            (acc, [k, v]) => {
              acc[k] = v as string;
              return acc;
            },
            {} as Record<string, string>,
          )
        : args ?? {};

    if (proxy) {
      // Proxy mode: POST to the proxy endpoint.
      const result = await proxyFetch({
        action: "auth:signIn",
        args: { provider, params },
      });
      if (result.redirect !== undefined) {
        const redirectUrl = new URL(result.redirect);
        // Verifier is stored server-side in an httpOnly cookie.
        if (typeof window !== "undefined") {
          window.location.href = redirectUrl.toString();
        }
        return { signingIn: false, redirect: redirectUrl };
      }
      if (result.tokens !== undefined) {
        // Proxy returns { token, refreshToken: "dummy" }.
        // Store JWT in memory only — real refresh token is in httpOnly cookie.
        await setToken({
          shouldStore: false,
          tokens:
            result.tokens === null ? null : { token: result.tokens.token },
        });
        return { signingIn: result.tokens !== null };
      }
      return { signingIn: false };
    }

    // SPA mode: call Convex directly.
    const verifier = (await storageGet(VERIFIER_STORAGE_KEY)) ?? undefined;
    await storageRemove(VERIFIER_STORAGE_KEY);
    const result = await convex.action("auth:signIn" as any, {
      provider,
      params,
      verifier,
    });
    if (result.redirect !== undefined) {
      const redirectUrl = new URL(result.redirect);
      await storageSet(VERIFIER_STORAGE_KEY, result.verifier!);
      if (typeof window !== "undefined") {
        window.location.href = redirectUrl.toString();
      }
      return { signingIn: false, redirect: redirectUrl };
    }
    if (result.tokens !== undefined) {
      await setToken({
        shouldStore: true,
        tokens: (result.tokens as AuthSession | null) ?? null,
      });
      return { signingIn: result.tokens !== null };
    }
    return { signingIn: false };
  };

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------

  const signOut = async () => {
    if (proxy) {
      try {
        await proxyFetch({ action: "auth:signOut", args: {} });
      } catch {
        // Already signed out is fine.
      }
      await setToken({ shouldStore: false, tokens: null });
      return;
    }

    // SPA mode.
    try {
      await convex.action("auth:signOut" as any, {});
    } catch {
      // Already signed out is fine.
    }
    await setToken({ shouldStore: true, tokens: null });
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
      const tokenBeforeRefresh = token;
      return await browserMutex("__convexAuthProxyRefresh", async () => {
        // Another tab/call may have already refreshed.
        if (token !== tokenBeforeRefresh) return token;
        try {
          const result = await proxyFetch({
            action: "auth:signIn",
            args: { refreshToken: true },
          });
          if (result.tokens) {
            await setToken({
              shouldStore: false,
              tokens: { token: result.tokens.token },
            });
          } else {
            await setToken({ shouldStore: false, tokens: null });
          }
        } catch {
          await setToken({ shouldStore: false, tokens: null });
        }
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
        return null;
      }
      await verifyCodeAndSetToken({ refreshToken });
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
    const codeUrl = new URL(window.location.href);
    codeUrl.searchParams.delete("code");
    try {
      await replaceURL(codeUrl.pathname + codeUrl.search + codeUrl.hash);
      await signIn(undefined, { code });
    } finally {
      handlingCodeFlow = false;
    }
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
   * Subscribe to auth state changes. Immediately invokes the callback
   * with the current state and returns an unsubscribe function.
   *
   * ```ts
   * const unsub = auth.onChange(setState)
   * ```
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
    const onStorage = (event: StorageEvent) => {
      void (async () => {
        if (event.key !== key(JWT_STORAGE_KEY)) return;
        await setToken({
          shouldStore: false,
          tokens:
            event.newValue === null ? null : { token: event.newValue },
        });
      })();
    };
    window.addEventListener("storage", onStorage);
  }

  // Auto-wire: feed our tokens into the Convex client so
  // queries and mutations are automatically authenticated.
  convex.setAuth(fetchAccessToken);

  // Auto-hydrate and handle code flow.
  if (typeof window !== "undefined") {
    if (proxy) {
      // Proxy mode: if no initialToken was provided, try a refresh
      // to pick up any existing session from httpOnly cookies.
      if (!hasServerToken) {
        void fetchAccessToken({ forceRefreshToken: true });
      } else {
        // initialToken already set — mark loading as done.
        isLoading = false;
        updateSnapshot();
      }
    } else {
      // SPA mode: hydrate from localStorage, then handle OAuth code flow.
      void hydrateFromStorage().then(() => handleCodeFlow());
    }
  }

  return {
    /** Current auth state snapshot. */
    get state(): AuthState {
      return snapshot;
    },
    signIn,
    signOut,
    onChange,
  };
}

// ---------------------------------------------------------------------------
// Browser mutex — ensures only one tab refreshes a token at a time.
// ---------------------------------------------------------------------------

async function browserMutex<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockManager = (globalThis as any)?.navigator?.locks;
  return lockManager !== undefined
    ? await lockManager.request(key, callback)
    : await manualMutex(key, callback);
}

function getMutexValue(key: string): {
  currentlyRunning: Promise<void> | null;
  waiting: Array<() => Promise<void>>;
} {
  if ((globalThis as any).__convexAuthMutexes === undefined) {
    (globalThis as any).__convexAuthMutexes = {} as Record<
      string,
      {
        currentlyRunning: Promise<void> | null;
        waiting: Array<() => Promise<void>>;
      }
    >;
  }
  let mutex = (globalThis as any).__convexAuthMutexes[key];
  if (mutex === undefined) {
    (globalThis as any).__convexAuthMutexes[key] = {
      currentlyRunning: null,
      waiting: [],
    };
  }
  mutex = (globalThis as any).__convexAuthMutexes[key];
  return mutex;
}

function setMutexValue(
  key: string,
  value: {
    currentlyRunning: Promise<void> | null;
    waiting: Array<() => Promise<void>>;
  },
) {
  (globalThis as any).__convexAuthMutexes[key] = value;
}

async function enqueueCallbackForMutex(
  key: string,
  callback: () => Promise<void>,
) {
  const mutex = getMutexValue(key);
  if (mutex.currentlyRunning === null) {
    setMutexValue(key, {
      currentlyRunning: callback().finally(() => {
        const nextCb = getMutexValue(key).waiting.shift();
        getMutexValue(key).currentlyRunning = null;
        setMutexValue(key, {
          ...getMutexValue(key),
          currentlyRunning:
            nextCb === undefined ? null : enqueueCallbackForMutex(key, nextCb),
        });
      }),
      waiting: [],
    });
  } else {
    setMutexValue(key, {
      ...mutex,
      waiting: [...mutex.waiting, callback],
    });
  }
}

async function manualMutex<T>(
  key: string,
  callback: () => Promise<T>,
): Promise<T> {
  const outerPromise = new Promise<T>((resolve, reject) => {
    const wrappedCallback: () => Promise<void> = () => {
      return callback()
        .then((v) => resolve(v))
        .catch((e) => reject(e));
    };
    void enqueueCallbackForMutex(key, wrappedCallback);
  });
  return outerPromise;
}
