import {
  createAuthClient,
  type AuthSnapshot,
  type SignInResult,
  type TokenStorage,
} from '@robelest/convex-auth/client'
import { ConvexHttpClient } from 'convex/browser'
import { ConvexProviderWithAuth, type ConvexReactClient } from 'convex/react'
import type { FunctionReference, OptionalRestArgs } from 'convex/server'
import type { Value } from 'convex/values'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

type PublicAction = FunctionReference<'action', 'public'>

type AuthActionContextValue = {
  signIn: (
    provider?: string,
    params?: FormData | Record<string, Value>,
  ) => Promise<SignInResult>
  signOut: () => Promise<void>
}

type ConvexAuthContextValue = {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (args: { forceRefreshToken: boolean }) => Promise<string | null>
}

type ConvexClientInternals = {
  address: string
  options?: {
    verbose?: boolean
  }
}

const AuthActionsContext = createContext<AuthActionContextValue | null>(null)
const ConvexAuthInternalContext = createContext<ConvexAuthContextValue | null>(null)

function useAuth() {
  const value = useContext(ConvexAuthInternalContext)
  if (!value) {
    throw new Error('useAuth must be used inside ConvexAuthProvider')
  }
  return value
}

function useAuthSnapshot(client: ReturnType<typeof createAuthClient>) {
  return useSyncExternalStore<AuthSnapshot>(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
}

export function useAuthActions() {
  const value = useContext(AuthActionsContext)
  if (!value) {
    throw new Error('useAuthActions must be used inside ConvexAuthProvider')
  }
  return value
}

export function ConvexAuthProvider({
  client,
  storage,
  storageNamespace,
  replaceURL,
  shouldHandleCode,
  children,
}: {
  client: ConvexReactClient
  storage?: TokenStorage | null
  storageNamespace?: string
  replaceURL?: (relativeUrl: string) => void | Promise<void>
  shouldHandleCode?: (() => boolean) | boolean
  children: ReactNode
}) {
  const internalClient = client as unknown as ConvexClientInternals
  const authClient = useMemo(
    () =>
      createAuthClient({
        transport: {
          authenticatedCall<TAction extends PublicAction>(
            action: TAction,
            ...args: OptionalRestArgs<TAction>
          ) {
            return client.action(action, ...args)
          },
          unauthenticatedCall<TAction extends PublicAction>(
            action: TAction,
            ...args: OptionalRestArgs<TAction>
          ) {
            return new ConvexHttpClient(internalClient.address, {
              logger: client.logger,
            }).action(action, ...args)
          },
          verbose: internalClient.options?.verbose,
          logger: client.logger,
        },
        storage:
          storage ?? (typeof window === 'undefined' ? null : window.localStorage),
        storageNamespace: storageNamespace ?? internalClient.address,
        replaceURL,
        shouldHandleCode,
      }),
    [client, internalClient.address, internalClient.options?.verbose, replaceURL, shouldHandleCode, storage, storageNamespace],
  )

  useEffect(() => {
    void authClient.hydrateFromStorage().then(() => authClient.handleCodeFlow())
  }, [authClient])

  const snapshot = useAuthSnapshot(authClient)
  const actions = useMemo(
    () => ({ signIn: authClient.signIn, signOut: authClient.signOut }),
    [authClient],
  )

  const authState = useMemo(
    () => ({
      isLoading: snapshot.isLoading,
      isAuthenticated: snapshot.isAuthenticated,
      fetchAccessToken: (args: { forceRefreshToken: boolean }) =>
        authClient.fetchAccessToken(args),
    }),
    [authClient, snapshot.isAuthenticated, snapshot.isLoading],
  )

  return (
    <ConvexAuthInternalContext.Provider value={authState}>
      <AuthActionsContext.Provider value={actions}>
        <ConvexProviderWithAuth client={client} useAuth={useAuth}>
          {children}
        </ConvexProviderWithAuth>
      </AuthActionsContext.Provider>
    </ConvexAuthInternalContext.Provider>
  )
}
