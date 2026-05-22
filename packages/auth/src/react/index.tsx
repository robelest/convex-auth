/**
 * React hooks for `@robelest/convex-auth/react`.
 *
 * Thin layer over the imperative `client(...)` from `@robelest/convex-auth/browser`
 * that exposes a single `useAuth()` composite hook plus a `ConvexAuthProvider`
 * for wiring the client into a React tree.
 *
 * @module
 */

"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import type { AuthApiRefs, AuthClient } from "../browser/index";
import type { AuthState } from "../client/core/types";

type AnyAuthClient = AuthClient<AuthApiRefs<boolean, boolean, boolean>>;

const AuthClientContext = createContext<AnyAuthClient | null>(null);

/**
 * Provide an auth client to descendant components.
 *
 * Wrap your app once near the root; create the client at module scope using
 * `client(...)` from `@robelest/convex-auth/browser`.
 *
 * @example
 * ```tsx
 * import { ConvexReactClient } from "convex/react";
 * import { client } from "@robelest/convex-auth/browser";
 * import { ConvexAuthProvider } from "@robelest/convex-auth/react";
 *
 * const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
 * const auth = client({ convex, url: convex.url });
 *
 * <ConvexAuthProvider client={auth}>
 *   <App />
 * </ConvexAuthProvider>
 * ```
 */
export function ConvexAuthProvider({
  client,
  children,
}: {
  client: AnyAuthClient;
  children: ReactNode;
}): ReactElement {
  return <AuthClientContext.Provider value={client}>{children}</AuthClientContext.Provider>;
}

const SERVER_SNAPSHOT: AuthState = {
  phase: "loading",
  isLoading: true,
  isAuthenticated: false,
  token: null,
};

/**
 * Composite auth hook. Subscribes to the client's reactive auth state and
 * exposes the `signIn` / `signOut` actions in one shape.
 *
 * Returns `{ phase, isLoading, isAuthenticated, token, signIn, signOut }`.
 *
 * @example
 * ```tsx
 * function SignInButton() {
 *   const { isAuthenticated, signIn, signOut } = useAuth();
 *   return isAuthenticated
 *     ? <button onClick={() => signOut()}>Sign out</button>
 *     : <button onClick={() => signIn("google")}>Sign in</button>;
 * }
 * ```
 *
 * @throws Error when called outside a {@link ConvexAuthProvider}.
 */
export function useAuth() {
  const client = useContext(AuthClientContext);
  if (client === null) {
    throw new Error("useAuth() must be called within <ConvexAuthProvider>");
  }
  const state = useSyncExternalStore(
    (cb: () => void) => client.onChange(cb),
    () => client.state,
    () => SERVER_SNAPSHOT,
  );
  return {
    phase: state.phase,
    isLoading: state.isLoading,
    isAuthenticated: state.isAuthenticated,
    token: state.token,
    signIn: client.signIn,
    signOut: client.signOut,
  };
}

/**
 * Escape hatch for the underlying imperative client.
 *
 * Use when you need factor flows (`client.totp.*`, `client.passkey.*`,
 * `client.device.*`) or low-level methods (`completeOAuth`, `param`,
 * `initialize`) that aren't surfaced by {@link useAuth}.
 *
 * @throws Error when called outside a {@link ConvexAuthProvider}.
 */
export function useConvexAuthClient(): AnyAuthClient {
  const client = useContext(AuthClientContext);
  if (client === null) {
    throw new Error("useConvexAuthClient() must be called within <ConvexAuthProvider>");
  }
  return client;
}
