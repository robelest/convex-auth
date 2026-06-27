/**
 * React hooks for `@robelest/convex-auth/react`.
 *
 * @module
 */

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import { client as createBrowserClient, type AuthApiRefs, type AuthClient } from "../browser/index";
import type { ConvexTransport, AuthState } from "../client/core/types";

type AnyAuthClient = AuthClient<AuthApiRefs<boolean, boolean, boolean>>;

const AuthClientContext = createContext<AnyAuthClient | null>(null);

type BuildOptions = {
  client: ConvexTransport;
  tokenSeed?: string | null;
  proxyPath?: string;
  url?: string;
};

type SharedClient = {
  client: AnyAuthClient;
  source: ConvexTransport;
  proxyPath?: string;
  url?: string;
  refs: number;
  disposeScheduled: boolean;
};

type HotData = { shared?: SharedClient | null };

const hmr = (
  import.meta as ImportMeta & {
    hot?: { data: unknown; dispose(cb: (data: unknown) => void): void };
  }
).hot;
const hotData = (hmr?.data as HotData | undefined) ?? undefined;
let shared: SharedClient | null = hotData?.shared ?? null;
if (hmr) {
  hmr.dispose((data: unknown) => {
    (data as HotData).shared = shared;
  });
}

function configMatches(options: BuildOptions): boolean {
  return (
    shared !== null &&
    shared.source === options.client &&
    shared.proxyPath === options.proxyPath &&
    shared.url === options.url
  );
}

/**
 * Synchronously return the shared client for these options, building it when the
 * connection options change (the prior client is destroyed only when no provider
 * still holds it) and cancelling any pending teardown. Does not change the ref
 * count — `useState` calls this so the first render is never null on the client,
 * while ref bookkeeping stays in {@link retainAuthClient}/{@link releaseAuthClient}.
 */
function ensureAuthClient(options: BuildOptions): AnyAuthClient {
  if (configMatches(options) && shared !== null) {
    shared.disposeScheduled = false;
    return shared.client;
  }
  if (shared !== null && shared.refs <= 0) {
    shared.client.destroy();
  }
  shared = {
    client: createBrowserClient({
      convex: options.client,
      tokenSeed: options.tokenSeed,
      proxyPath: options.proxyPath,
      url: options.url,
    }),
    source: options.client,
    proxyPath: options.proxyPath,
    url: options.url,
    refs: 0,
    disposeScheduled: false,
  };
  return shared.client;
}

/** Retain the shared client for a mounted provider. Balanced by {@link releaseAuthClient}. */
function retainAuthClient(options: BuildOptions): AnyAuthClient {
  const client = ensureAuthClient(options);
  if (shared !== null && shared.client === client) {
    shared.refs += 1;
  }
  return client;
}

/**
 * Release a client retained by {@link retainAuthClient}. The shared client is
 * destroyed once the last provider unmounts; the teardown is deferred a tick so
 * React StrictMode's synchronous unmount/remount (or an immediate remount with
 * the same options) re-retains the same client instead of churning it.
 */
function releaseAuthClient(authClient: AnyAuthClient): void {
  if (shared === null || shared.client !== authClient) return;
  shared.refs -= 1;
  if (shared.refs <= 0) {
    const entry = shared;
    entry.disposeScheduled = true;
    setTimeout(() => {
      if (entry.disposeScheduled && entry.refs <= 0 && shared === entry) {
        entry.client.destroy();
        shared = null;
      }
    }, 0);
  }
}

/**
 * Provide auth state and helpers to descendant components.
 *
 * Wrap your app once near the root, alongside Convex's own
 * `<ConvexProvider client={convex}>`. The `client` prop mirrors
 * `<ConvexProvider client={...}>` semantics — pass the same `ConvexReactClient`
 * to both.
 *
 * @example
 * ```tsx
 * import { ConvexProvider, ConvexReactClient } from "convex/react";
 * import { ConvexAuthProvider } from "@robelest/convex-auth/react";
 *
 * const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
 *
 * <ConvexProvider client={convex}>
 *   <ConvexAuthProvider client={convex} tokenSeed={ssrToken} proxyPath="/api/auth">
 *     <App />
 *   </ConvexAuthProvider>
 * </ConvexProvider>
 * ```
 */
export function ConvexAuthProvider({
  client,
  tokenSeed,
  proxyPath,
  url,
  children,
}: {
  client: ConvexTransport;
  tokenSeed?: string | null;
  proxyPath?: string;
  url?: string;
  children: ReactNode;
}): ReactElement {
  const [authClient, setAuthClient] = useState<AnyAuthClient | null>(() =>
    typeof window === "undefined" ? null : ensureAuthClient({ client, tokenSeed, proxyPath, url }),
  );
  useEffect(() => {
    const retained = retainAuthClient({ client, tokenSeed, proxyPath, url });
    setAuthClient(retained);
    return () => releaseAuthClient(retained);
  }, [client, tokenSeed, proxyPath, url]);
  return <AuthClientContext.Provider value={authClient}>{children}</AuthClientContext.Provider>;
}

const SERVER_SNAPSHOT: AuthState = {
  phase: "loading",
  isLoading: true,
  isAuthenticated: false,
  token: null,
};

/**
 * Composite auth hook. Subscribes to the reactive auth state and exposes
 * `signIn` / `signOut` in one shape.
 *
 * Returns `{ phase, isLoading, isAuthenticated, token, signIn, signOut }`.
 * During SSR the state is `SERVER_SNAPSHOT` (`isLoading: true`,
 * `isAuthenticated: false`).
 *
 * @throws Error when called outside a {@link ConvexAuthProvider}.
 */
export function useAuth() {
  const client = useContext(AuthClientContext);
  const state = useSyncExternalStore(
    (cb: () => void) => (client ? client.onChange(cb) : () => {}),
    () => client?.state ?? SERVER_SNAPSHOT,
    () => SERVER_SNAPSHOT,
  );
  return {
    phase: state.phase,
    isLoading: state.isLoading,
    isAuthenticated: state.isAuthenticated,
    token: state.token,
    signIn: client?.signIn,
    signOut: client?.signOut,
  };
}

/**
 * Escape hatch for the underlying imperative client.
 *
 * Use when you need factor flows (`client.totp.*`, `client.passkey.*`,
 * `client.device.*`) or low-level methods (`completeOAuth`, `param`,
 * `initialize`) that aren't surfaced by {@link useAuth}.
 *
 * Returns `null` during SSR; the client is constructed lazily on first
 * client render.
 *
 * @throws Error when called outside a {@link ConvexAuthProvider}.
 */
export function useConvexAuthClient(): AnyAuthClient | null {
  return useContext(AuthClientContext);
}
