import { FunctionReference, OptionalRestArgs } from "convex/server";
import { Value } from "convex/values";
import type {
  SignInAction,
  SignOutAction,
} from "../server/implementation/index.js";

type AuthActionCaller = {
  authenticatedCall<Action extends FunctionReference<"action", "public">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<Action["_returnType"]>;
  unauthenticatedCall<Action extends FunctionReference<"action", "public">>(
    action: Action,
    ...args: OptionalRestArgs<Action>
  ): Promise<Action["_returnType"]>;
  verbose?: boolean;
  logger?: {
    logVerbose?: (message: string) => void;
  };
};

export interface TokenStorage {
  getItem(key: string): string | null | undefined | Promise<string | null | undefined>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export type AuthSession = {
  token: string;
  refreshToken: string;
};

export type SignInResult = {
  signingIn: boolean;
  redirect?: URL;
};

export type AuthSnapshot = {
  isLoading: boolean;
  isAuthenticated: boolean;
  token: string | null;
};

export type AuthClientOptions = {
  transport: AuthActionCaller;
  storage?: TokenStorage | null;
  storageNamespace: string;
  replaceURL?: (relativeUrl: string) => void | Promise<void>;
  shouldHandleCode?: (() => boolean) | boolean;
  onChange?: () => Promise<unknown>;
};

const VERIFIER_STORAGE_KEY = "__convexAuthOAuthVerifier";
const JWT_STORAGE_KEY = "__convexAuthJWT";
const REFRESH_TOKEN_STORAGE_KEY = "__convexAuthRefreshToken";

const RETRY_BACKOFF = [500, 2000];
const RETRY_JITTER = 100;

export function createAuthClient(options: AuthClientOptions) {
  const {
    transport,
    storage = typeof window === "undefined" ? null : window.localStorage,
    storageNamespace,
    replaceURL = (url: string) => {
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", url);
      }
    },
    shouldHandleCode,
    onChange,
  } = options;

  const escapedNamespace = storageNamespace.replace(/[^a-zA-Z0-9]/g, "");
  const key = (name: string) => `${name}_${escapedNamespace}`;
  const subscribers = new Set<() => void>();

  let token: string | null = null;
  let isLoading = true;
  let snapshot: AuthSnapshot = {
    isLoading,
    isAuthenticated: false,
    token,
  };
  let handlingCodeFlow = false;

  const logVerbose = (message: string) => {
    if (transport.verbose) {
      transport.logger?.logVerbose?.(message);
      console.debug(`${new Date().toISOString()} ${message}`);
    }
  };

  const notify = () => {
    for (const cb of subscribers) cb();
  };

  const updateSnapshot = () => {
    const nextSnapshot: AuthSnapshot = {
      isLoading,
      isAuthenticated: token !== null,
      token,
    };
    if (
      snapshot.isLoading === nextSnapshot.isLoading &&
      snapshot.isAuthenticated === nextSnapshot.isAuthenticated &&
      snapshot.token === nextSnapshot.token
    ) {
      return false;
    }
    snapshot = nextSnapshot;
    return true;
  };

  const storageGet = async (name: string) =>
    storage ? ((await storage.getItem(key(name))) ?? null) : null;
  const storageSet = async (name: string, value: string) => {
    if (storage) await storage.setItem(key(name), value);
  };
  const storageRemove = async (name: string) => {
    if (storage) await storage.removeItem(key(name));
  };

  const setToken = async (
    args:
      | { shouldStore: true; tokens: AuthSession | null }
      | { shouldStore: false; tokens: { token: string } | null },
  ) => {
    const wasAuthenticated = token !== null;
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
    if (wasAuthenticated !== (token !== null)) {
      await onChange?.();
    }
    const hadPendingLoad = isLoading;
    isLoading = false;
    const changed = updateSnapshot();
    if (hadPendingLoad || changed) {
      notify();
    }
  };

  const verifyCode = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    let lastError: unknown;
    let retry = 0;
    while (retry < RETRY_BACKOFF.length) {
      try {
        return await transport.unauthenticatedCall(
          "auth:signIn" as unknown as SignInAction,
          "code" in args
            ? { params: { code: args.code }, verifier: args.verifier }
            : args,
        );
      } catch (e) {
        lastError = e;
        const isNetworkError =
          e instanceof Error && /network/i.test(e.message || "");
        if (!isNetworkError) break;
        const wait = RETRY_BACKOFF[retry] + RETRY_JITTER * Math.random();
        retry++;
        logVerbose(
          `verifyCode network retry ${retry}/${RETRY_BACKOFF.length} in ${wait}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastError;
  };

  const verifyCodeAndSetToken = async (
    args: { code: string; verifier?: string } | { refreshToken: string },
  ) => {
    const { tokens } = await verifyCode(args);
    await setToken({ shouldStore: true, tokens: (tokens as AuthSession | null) ?? null });
    return tokens !== null;
  };

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

    const verifier = (await storageGet(VERIFIER_STORAGE_KEY)) ?? undefined;
    await storageRemove(VERIFIER_STORAGE_KEY);
    const result = await transport.authenticatedCall(
      "auth:signIn" as unknown as SignInAction,
      { provider, params, verifier },
    );
    if (result.redirect !== undefined) {
      const url = new URL(result.redirect);
      await storageSet(VERIFIER_STORAGE_KEY, result.verifier!);
      if (typeof window !== "undefined") {
        window.location.href = url.toString();
      }
      return { signingIn: false, redirect: url };
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

  const signOut = async () => {
    try {
      await transport.authenticatedCall(
        "auth:signOut" as unknown as SignOutAction,
      );
    } catch {
      // Already signed out is fine.
    }
    await setToken({ shouldStore: true, tokens: null });
  };

  const fetchAccessToken = async ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean;
  }): Promise<string | null> => {
    if (!forceRefreshToken) return token;
    const tokenBeforeLockAcquisition = token;
    return await browserMutex(REFRESH_TOKEN_STORAGE_KEY, async () => {
      const tokenAfterLockAcquisition = token;
      if (tokenAfterLockAcquisition !== tokenBeforeLockAcquisition) {
        logVerbose(
          `fetchAccessToken using synchronized token, is null: ${tokenAfterLockAcquisition === null}`,
        );
        return tokenAfterLockAcquisition;
      }
      const refreshToken = (await storageGet(REFRESH_TOKEN_STORAGE_KEY)) ?? null;
      if (!refreshToken) {
        logVerbose("fetchAccessToken found no refresh token");
        return null;
      }
      await verifyCodeAndSetToken({ refreshToken });
      return token;
    });
  };

  const handleCodeFlow = async () => {
    if (typeof window === "undefined") return;
    if (handlingCodeFlow) return;
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    const shouldRun =
      shouldHandleCode === undefined
        ? true
        : typeof shouldHandleCode === "function"
          ? shouldHandleCode()
          : shouldHandleCode;
    if (!shouldRun) return;
    handlingCodeFlow = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("code");
    try {
      await replaceURL(url.pathname + url.search + url.hash);
      await signIn(undefined, { code });
    } finally {
      handlingCodeFlow = false;
    }
  };

  const hydrateFromStorage = async () => {
    const storedToken = (await storageGet(JWT_STORAGE_KEY)) ?? null;
    await setToken({
      shouldStore: false,
      tokens: storedToken === null ? null : { token: storedToken },
    });
  };

  const getSnapshot = (): AuthSnapshot => snapshot;

  const subscribe = (cb: () => void) => {
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };

  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      void (async () => {
        if (event.key !== key(JWT_STORAGE_KEY)) {
          return;
        }
        const value = event.newValue;
        await setToken({
          shouldStore: false,
          tokens: value === null ? null : { token: value },
        });
      })();
    };
    window.addEventListener("storage", onStorage);
  }

  return {
    signIn,
    signOut,
    fetchAccessToken,
    handleCodeFlow,
    hydrateFromStorage,
    getSnapshot,
    subscribe,
  };
}

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
