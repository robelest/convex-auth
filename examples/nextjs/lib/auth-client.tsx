"use client";

import {
  AuthSnapshot,
  AuthSession,
  SignInResult,
  TokenStorage,
  createAuthClient,
} from "@robelest/convex-auth/client";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { Value } from "convex/values";
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

const AuthActionsContext = createContext<{
  signIn: (provider?: string, params?: FormData | Record<string, Value>) => Promise<SignInResult>;
  signOut: () => Promise<void>;
} | null>(null);

const ConvexAuthInternalContext = createContext<{
  isLoading: boolean;
  isAuthenticated: boolean;
  fetchAccessToken: ({ forceRefreshToken }: { forceRefreshToken: boolean }) => Promise<string | null>;
} | null>(null);

function useAuth() {
  const value = useContext(ConvexAuthInternalContext);
  if (value === null) {
    throw new Error("useAuth must be used inside ConvexAuthProvider");
  }
  return value;
}

function useAuthSnapshot(client: ReturnType<typeof createAuthClient>) {
  return useSyncExternalStore<AuthSnapshot>(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
}

export function useAuthActions() {
  const value = useContext(AuthActionsContext);
  if (value === null) {
    throw new Error("useAuthActions must be used inside ConvexAuthProvider");
  }
  return value;
}

export function ConvexAuthProvider({
  client,
  children,
  storage,
}: {
  client: ConvexReactClient;
  children: ReactNode;
  storage?: TokenStorage | null;
}) {
  const authClient = useMemo(
    () =>
      createAuthClient({
        transport: {
          authenticatedCall(action: any, args: any) {
            return client.action(action, args);
          },
          unauthenticatedCall(
            action: any,
            args: any,
          ): Promise<{ tokens?: AuthSession | null; redirect?: string; verifier?: string }> {
            return fetch("/api/auth", {
              method: "POST",
              body: JSON.stringify({ action, args }),
            }).then(async (response) => {
              const payload = await response.json();
              if (response.status >= 400) {
                throw new Error(payload.error ?? "Auth request failed");
              }
              return payload;
            });
          },
          verbose: (client as any).options?.verbose,
          logger: client.logger,
        },
        storage:
          storage ??
          (typeof window === "undefined" ? null : window.localStorage),
        storageNamespace: process.env.NEXT_PUBLIC_CONVEX_URL ?? "convex-auth",
      }),
    [client, storage],
  );

  useEffect(() => {
    void authClient.hydrateFromStorage().then(() => authClient.handleCodeFlow());
  }, [authClient]);

  const snapshot = useAuthSnapshot(authClient);

  const actions = useMemo(
    () => ({ signIn: authClient.signIn, signOut: authClient.signOut }),
    [authClient],
  );

  const authState = useMemo(
    () => ({
      isLoading: snapshot.isLoading,
      isAuthenticated: snapshot.isAuthenticated,
      fetchAccessToken: ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
        authClient.fetchAccessToken({ forceRefreshToken }),
    }),
    [authClient, snapshot.isAuthenticated, snapshot.isLoading],
  );

  return (
    <ConvexAuthInternalContext.Provider value={authState}>
      <AuthActionsContext.Provider value={actions}>
        <ConvexProviderWithAuth client={client} useAuth={useAuth}>
          {children}
        </ConvexProviderWithAuth>
      </AuthActionsContext.Provider>
    </ConvexAuthInternalContext.Provider>
  );
}
