import {
  AuthSnapshot,
  SignInResult,
  TokenStorage,
  createAuthClient,
} from "@robelest/convex-auth/client";
import { ConvexHttpClient } from "convex/browser";
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
  if (!value) {
    throw new Error("useAuth must be used inside ConvexAuthProvider");
  }
  return value;
}

function useAuthSnapshot(client: ReturnType<typeof createAuthClient>) {
  return useSyncExternalStore<AuthSnapshot>(client.subscribe, client.getSnapshot);
}

export function useAuthActions() {
  const value = useContext(AuthActionsContext);
  if (!value) {
    throw new Error("useAuthActions must be used inside ConvexAuthProvider");
  }
  return value;
}

export function ConvexAuthProvider({
  client,
  storage,
  storageNamespace,
  replaceURL,
  shouldHandleCode,
  children,
}: {
  client: ConvexReactClient;
  storage?: TokenStorage | null;
  storageNamespace?: string;
  replaceURL?: (relativeUrl: string) => void | Promise<void>;
  shouldHandleCode?: (() => boolean) | boolean;
  children: ReactNode;
}) {
  const authClient = useMemo(
    () =>
      createAuthClient({
        transport: {
          authenticatedCall(action: any, args: any) {
            return client.action(action, args);
          },
          unauthenticatedCall(action: any, args: any) {
            return new ConvexHttpClient((client as any).address, {
              logger: client.logger,
            }).action(action, args);
          },
          verbose: (client as any).options?.verbose,
          logger: client.logger,
        },
        storage:
          storage ??
          (typeof window === "undefined" ? null : window.localStorage),
        storageNamespace: storageNamespace ?? (client as any).address,
        replaceURL,
        shouldHandleCode,
      }),
    [client, storage, storageNamespace, replaceURL, shouldHandleCode],
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
