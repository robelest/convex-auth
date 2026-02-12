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
  totpRequired?: boolean;
  verifier?: string;
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
      if (result.totpRequired) {
        return { signingIn: false, totpRequired: true, verifier: result.verifier };
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
    if (result.totpRequired) {
      return { signingIn: false, totpRequired: true, verifier: result.verifier };
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

  // ---------------------------------------------------------------------------
  // Passkey helpers
  // ---------------------------------------------------------------------------

  /**
   * Base64url encode/decode helpers for the WebAuthn credential API.
   * These run client-side only (browser context).
   */
  const base64urlEncode = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const base64urlDecode = (str: string): Uint8Array => {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const passkey = {
    /**
     * Check if WebAuthn passkeys are supported in the current environment.
     */
    isSupported: (): boolean => {
      return (
        typeof window !== "undefined" &&
        typeof window.PublicKeyCredential !== "undefined"
      );
    },

    /**
     * Check if conditional UI (autofill-assisted passkey sign-in) is supported.
     *
     * ```ts
     * if (await auth.passkey.isAutofillSupported()) {
     *   auth.passkey.authenticate({ autofill: true });
     * }
     * ```
     */
    isAutofillSupported: async (): Promise<boolean> => {
      if (typeof window === "undefined") return false;
      if (typeof window.PublicKeyCredential === "undefined") return false;
      if (
        typeof (
          window.PublicKeyCredential as any
        ).isConditionalMediationAvailable !== "function"
      ) {
        return false;
      }
      return (
        window.PublicKeyCredential as any
      ).isConditionalMediationAvailable();
    },

    /**
     * Register a new passkey for the current or new user.
     *
     * Performs the full two-round-trip WebAuthn registration ceremony:
     * 1. Requests creation options from the server (challenge, RP info)
     * 2. Calls `navigator.credentials.create()` with the options
     * 3. Sends the attestation back to the server for verification
     * 4. Server creates user + account + passkey records and returns tokens
     *
     * Works in both SPA and proxy (SSR) modes.
     *
     * ```ts
     * await auth.passkey.register({ name: "MacBook Touch ID" });
     * ```
     *
     * @param opts.name - Friendly name for this passkey
     * @param opts.email - Email to associate with the new account
     * @param opts.userName - Username for the credential (defaults to email)
     * @param opts.userDisplayName - Display name for the credential
     * @returns `{ signingIn: true }` on success
     */
    register: async (
      opts?: {
        name?: string;
        email?: string;
        userName?: string;
        userDisplayName?: string;
      },
    ): Promise<SignInResult> => {
      const phase1Params = {
        flow: "register-options",
        email: opts?.email,
        userName: opts?.userName,
        userDisplayName: opts?.userDisplayName,
      };

      // Phase 1: Get registration options from server
      let phase1Result: any;
      if (proxy) {
        phase1Result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "passkey", params: phase1Params },
        });
      } else {
        phase1Result = await convex.action("auth:signIn" as any, {
          provider: "passkey",
          params: phase1Params,
        });
      }

      if (!phase1Result.options) {
        throw new Error("Server did not return passkey registration options");
      }

      const options = phase1Result.options;

      // Convert base64url strings to ArrayBuffers for the credential API
      const createOptions: CredentialCreationOptions = {
        publicKey: {
          rp: options.rp,
          user: {
            id: base64urlDecode(options.user.id).buffer as ArrayBuffer,
            name: options.user.name,
            displayName: options.user.displayName,
          },
          challenge: base64urlDecode(options.challenge).buffer as ArrayBuffer,
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation,
          authenticatorSelection: options.authenticatorSelection,
          excludeCredentials: (options.excludeCredentials ?? []).map(
            (cred: any) => ({
              type: cred.type ?? "public-key",
              id: base64urlDecode(cred.id).buffer as ArrayBuffer,
              transports: cred.transports,
            }),
          ),
        },
      };

      // Phase 2: Create credential via browser API
      const credential = (await navigator.credentials.create(
        createOptions,
      )) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error("Passkey registration was cancelled");
      }

      const response =
        credential.response as AuthenticatorAttestationResponse;

      // Extract transports if available
      const transports =
        typeof response.getTransports === "function"
          ? response.getTransports()
          : undefined;

      const phase2Params = {
        flow: "register-verify",
        clientDataJSON: base64urlEncode(response.clientDataJSON),
        attestationObject: base64urlEncode(response.attestationObject),
        transports,
        passkeyName: opts?.name,
        email: opts?.email,
      };

      // Phase 3: Send attestation to server for verification
      let phase2Result: any;
      if (proxy) {
        // In proxy mode the verifier is stored in an httpOnly cookie by the proxy.
        // We pass it back explicitly so the proxy can forward it to Convex.
        phase2Result = await proxyFetch({
          action: "auth:signIn",
          args: {
            provider: "passkey",
            params: phase2Params,
            verifier: phase1Result.verifier,
          },
        });
      } else {
        phase2Result = await convex.action("auth:signIn" as any, {
          provider: "passkey",
          params: phase2Params,
          verifier: phase1Result.verifier,
        });
      }

      if (phase2Result.tokens) {
        if (proxy) {
          await setToken({
            shouldStore: false,
            tokens:
              phase2Result.tokens === null
                ? null
                : { token: phase2Result.tokens.token },
          });
        } else {
          await setToken({
            shouldStore: true,
            tokens: phase2Result.tokens as AuthSession,
          });
        }
        return { signingIn: true };
      }
      return { signingIn: false };
    },

    /**
     * Authenticate with an existing passkey.
     *
     * Performs the full two-round-trip WebAuthn authentication ceremony:
     * 1. Requests assertion options from the server (challenge, allowed credentials)
     * 2. Calls `navigator.credentials.get()` with the options
     * 3. Sends the assertion back to the server for signature verification
     * 4. Server verifies signature, updates counter, creates session, returns tokens
     *
     * Works in both SPA and proxy (SSR) modes.
     *
     * ```ts
     * // Discoverable credential (no email needed)
     * await auth.passkey.authenticate();
     *
     * // Scoped to a specific user's credentials
     * await auth.passkey.authenticate({ email: "user@example.com" });
     *
     * // Autofill-assisted (conditional UI)
     * await auth.passkey.authenticate({ autofill: true });
     * ```
     *
     * @param opts.email - Scope to credentials for this email's user
     * @param opts.autofill - Use conditional mediation (autofill UI)
     * @returns `{ signingIn: true }` on success
     */
    authenticate: async (
      opts?: { email?: string; autofill?: boolean },
    ): Promise<SignInResult> => {
      const phase1Params = {
        flow: "auth-options",
        email: opts?.email,
      };

      // Phase 1: Get assertion options from server
      let phase1Result: any;
      if (proxy) {
        phase1Result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "passkey", params: phase1Params },
        });
      } else {
        phase1Result = await convex.action("auth:signIn" as any, {
          provider: "passkey",
          params: phase1Params,
        });
      }

      if (!phase1Result.options) {
        throw new Error("Server did not return passkey authentication options");
      }

      const options = phase1Result.options;

      // Convert base64url strings to ArrayBuffers for the credential API
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge: base64urlDecode(options.challenge).buffer as ArrayBuffer,
          timeout: options.timeout,
          rpId: options.rpId,
          userVerification: options.userVerification,
          allowCredentials: (options.allowCredentials ?? []).map(
            (cred: any) => ({
              type: cred.type ?? "public-key",
              id: base64urlDecode(cred.id).buffer as ArrayBuffer,
              transports: cred.transports,
            }),
          ),
        },
        ...(opts?.autofill ? { mediation: "conditional" as any } : {}),
      };

      // Phase 2: Get credential via browser API
      const credential = (await navigator.credentials.get(
        getOptions,
      )) as PublicKeyCredential | null;
      if (!credential) {
        throw new Error("Passkey authentication was cancelled");
      }

      const response =
        credential.response as AuthenticatorAssertionResponse;

      const phase2Params = {
        flow: "auth-verify",
        credentialId: base64urlEncode(credential.rawId),
        clientDataJSON: base64urlEncode(response.clientDataJSON),
        authenticatorData: base64urlEncode(response.authenticatorData),
        signature: base64urlEncode(response.signature),
      };

      // Phase 3: Send assertion to server for verification
      let phase2Result: any;
      if (proxy) {
        phase2Result = await proxyFetch({
          action: "auth:signIn",
          args: {
            provider: "passkey",
            params: phase2Params,
            verifier: phase1Result.verifier,
          },
        });
      } else {
        phase2Result = await convex.action("auth:signIn" as any, {
          provider: "passkey",
          params: phase2Params,
          verifier: phase1Result.verifier,
        });
      }

      if (phase2Result.tokens) {
        if (proxy) {
          await setToken({
            shouldStore: false,
            tokens:
              phase2Result.tokens === null
                ? null
                : { token: phase2Result.tokens.token },
          });
        } else {
          await setToken({
            shouldStore: true,
            tokens: phase2Result.tokens as AuthSession,
          });
        }
        return { signingIn: true };
      }
      return { signingIn: false };
    },
  };

  const totp = {
    /**
     * Start TOTP enrollment. Must be authenticated.
     *
     * Returns a URI for QR code display and a base32 secret for manual entry.
     *
     * ```ts
     * const setup = await auth.totp.setup();
     * // Display QR code from setup.uri
     * // Or show setup.secret for manual entry
     * ```
     */
    setup: async (
      opts?: { name?: string; accountName?: string },
    ): Promise<{ uri: string; secret: string; verifier: string; totpId: string }> => {
      const params: Record<string, any> = { flow: "setup" };
      if (opts?.name) params.name = opts.name;
      if (opts?.accountName) params.accountName = opts.accountName;

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params },
        });
        return { uri: result.totpSetup.uri, secret: result.totpSetup.secret, verifier: result.verifier, totpId: result.totpSetup.totpId };
      }

      const result = await convex.action("auth:signIn" as any, {
        provider: "totp",
        params,
      });
      return { uri: result.totpSetup.uri, secret: result.totpSetup.secret, verifier: result.verifier, totpId: result.totpSetup.totpId };
    },

    /**
     * Complete TOTP enrollment by verifying the first code from the authenticator app.
     *
     * ```ts
     * await auth.totp.confirm({ code: "123456", verifier: setup.verifier, totpId: setup.totpId });
     * ```
     */
    confirm: async (opts: {
      code: string;
      verifier: string;
      totpId: string;
    }): Promise<void> => {
      const params: Record<string, any> = {
        flow: "confirm",
        code: opts.code,
        totpId: opts.totpId,
      };

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params, verifier: opts.verifier },
        });
        if (result.tokens) {
          await setToken({
            shouldStore: false,
            tokens: result.tokens === null ? null : { token: result.tokens.token },
          });
        }
        return;
      }

      const result = await convex.action("auth:signIn" as any, {
        provider: "totp",
        params,
        verifier: opts.verifier,
      });
      if (result.tokens) {
        await setToken({
          shouldStore: true,
          tokens: (result.tokens as AuthSession | null) ?? null,
        });
      }
    },

    /**
     * Complete 2FA verification during sign-in.
     *
     * Called after a credentials sign-in returns `totpRequired: true`.
     *
     * ```ts
     * const result = await auth.signIn("password", { email, password });
     * if (result.totpRequired) {
     *   await auth.totp.verify({ code: "123456", verifier: result.verifier! });
     * }
     * ```
     */
    verify: async (opts: { code: string; verifier: string }): Promise<void> => {
      const params: Record<string, any> = {
        flow: "verify",
        code: opts.code,
      };

      if (proxy) {
        const result = await proxyFetch({
          action: "auth:signIn",
          args: { provider: "totp", params, verifier: opts.verifier },
        });
        if (result.tokens) {
          await setToken({
            shouldStore: false,
            tokens: result.tokens === null ? null : { token: result.tokens.token },
          });
        }
        return;
      }

      const result = await convex.action("auth:signIn" as any, {
        provider: "totp",
        params,
        verifier: opts.verifier,
      });
      if (result.tokens) {
        await setToken({
          shouldStore: true,
          tokens: (result.tokens as AuthSession | null) ?? null,
        });
      }
    },
  };

  return {
    /** Current auth state snapshot. */
    get state(): AuthState {
      return snapshot;
    },
    signIn,
    signOut,
    onChange,
    /** Passkey (WebAuthn) authentication helpers. */
    passkey,
    /** TOTP two-factor authentication helpers. */
    totp,
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
