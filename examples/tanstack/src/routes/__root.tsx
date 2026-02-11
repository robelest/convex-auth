import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { ConvexReactClient, useQuery } from 'convex/react'
import { useMemo } from 'react'

import appCss from '../styles.css?url'
import { api } from '@convex/_generated/api'
import { UserMenu } from '@/components/user-menu'
import { Authenticated, ConvexAuthProvider, Unauthenticated } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Server function: runs during SSR to refresh tokens, handle OAuth code
// exchange, and provide the initial JWT for flash-free client hydration.
// ---------------------------------------------------------------------------

const getAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
  const { server } = await import('@robelest/convex-auth/server')
  const request = getRequest()
  const auth = server()

  // Handle OAuth code exchange + token refresh.
  const result = await auth.refresh(request)

  if (result.response) {
    // OAuth code exchange produced a redirect response with Set-Cookie headers.
    // Forward cookies to the browser via the SSR response.
    const cookieHeaders = result.response.headers.getSetCookie?.() ?? []
    for (const raw of cookieHeaders) {
      setResponseHeader('set-cookie', raw)
    }
    const location = result.response.headers.get('location')
    return { token: null as string | null, redirect: location }
  }

  if (result.cookies) {
    // Token was refreshed — forward updated cookies.
    for (const raw of result.cookies) {
      setResponseHeader('set-cookie', raw)
    }
  }

  // Return the JWT from the httpOnly cookie for client hydration.
  return { token: auth.token(request), redirect: null as string | null }
})

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Convex Auth TanStack Demo',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  beforeLoad: async () => {
    const { token, redirect: redirectUrl } = await getAuthState()
    if (redirectUrl) {
      throw redirect({ href: redirectUrl })
    }
    return { initialToken: token }
  },
  component: RootApp,
  shellComponent: RootDocument,
})

function RootApp() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL
  const { initialToken } = Route.useRouteContext()

  if (!convexUrl) {
    throw new Error('Missing VITE_CONVEX_URL in environment')
  }

  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl])

  return (
    <ConvexAuthProvider convex={client} proxy="/api/auth" initialToken={initialToken}>
      <AppLayout />
    </ConvexAuthProvider>
  )
}

function AppLayout() {
  const user = useQuery(api.users.viewer)
  const userLabel = user?.name ?? user?.email ?? user?.phone ?? 'Anonymous'

  return (
    <div className="from-background to-muted/25 flex min-h-screen flex-col bg-linear-to-br">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="text-sm font-semibold tracking-wide uppercase">
            Convex Auth
          </Link>
          <div className="flex items-center gap-2">
            <Authenticated>
              <UserMenu label={userLabel} />
            </Authenticated>
            <Unauthenticated>
              <a href="/login" className="text-muted-foreground text-xs hover:text-foreground">
                Sign in
              </a>
            </Unauthenticated>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
