import { client } from '@robelest/convex-auth/client'
import type { AuthState } from '@robelest/convex-auth/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import type { Value } from 'convex/values'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

type PasskeyActions = {
  isSupported: () => boolean
  isAutofillSupported: () => Promise<boolean>
  register: (opts?: {
    name?: string
    email?: string
    userName?: string
    userDisplayName?: string
  }) => Promise<{ signingIn: boolean }>
  authenticate: (opts?: {
    email?: string
    autofill?: boolean
  }) => Promise<{ signingIn: boolean }>
}

type TotpActions = {
  setup: (opts?: { name?: string; accountName?: string }) => Promise<{ uri: string; secret: string; verifier: string; totpId: string }>
  confirm: (opts: { code: string; verifier: string; totpId: string }) => Promise<void>
  verify: (opts: { code: string; verifier: string }) => Promise<void>
}

const AuthContext = createContext<{
  signIn: (provider?: string, params?: FormData | Record<string, Value>) => Promise<{ totpRequired?: boolean; verifier?: string }>
  signOut: () => Promise<void>
  passkey: PasskeyActions
  totp: TotpActions
  state: AuthState
} | null>(null)



function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('Auth hooks must be used inside ConvexAuthProvider')
  return ctx
}

/** Read the current auth state (reactive). */
export function useAuthState() {
  return useAuth().state
}

/** Access `signIn`, `signOut`, and `passkey` actions. */
export function useAuthActions() {
  const { signIn, signOut, passkey, totp } = useAuth()
  return { signIn, signOut, passkey, totp }
}

// ---------------------------------------------------------------------------
// Auth-aware render helpers (replace Convex's Authenticated/Unauthenticated)
// ---------------------------------------------------------------------------

export function Authenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthState()
  if (isLoading || !isAuthenticated) return null
  return <>{children}</>
}

export function Unauthenticated({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthState()
  if (isLoading || isAuthenticated) return null
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ConvexAuthProvider({
  convex,
  proxy,
  token,
  children,
}: {
  convex: ConvexReactClient
  /** SSR proxy endpoint (e.g. `"/api/auth"`). */
  proxy?: string
  /** JWT from server-side hydration for flash-free startup. */
  token?: string | null
  children: ReactNode
}) {
  const auth = useMemo(
    () => client({ convex, proxy, token }),
    [convex, proxy, token],
  )
  const [state, setState] = useState<AuthState>(auth.state)
  useEffect(() => auth.onChange(setState), [auth])

  const value = useMemo(
    () => ({
      signIn: async (provider?: string, params?: FormData | Record<string, Value>) => {
        const result = await auth.signIn(provider, params)
        return { totpRequired: result.totpRequired, verifier: result.verifier }
      },
      signOut: auth.signOut,
      passkey: auth.passkey,
      totp: auth.totp,
      state,
    }),
    [auth, state],
  )

  return (
    <AuthContext.Provider value={value}>
      <ConvexProvider client={convex}>
        {children}
      </ConvexProvider>
    </AuthContext.Provider>
  )
}
