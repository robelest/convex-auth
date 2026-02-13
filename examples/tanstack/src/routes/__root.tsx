import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest, setCookie } from '@tanstack/react-start/server'
import { server } from '@robelest/convex-auth/server'
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
// exchange, and provide the JWT for flash-free client hydration.
// ---------------------------------------------------------------------------

const getAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const auth = server({ url: import.meta.env.VITE_CONVEX_URL! })

  const { cookies, redirect: redirectUrl, token } = await auth.refresh(request)

  // Forward auth cookies to the browser via the framework's cookie API.
  for (const c of cookies) {
    setCookie(c.name, c.value, c.options)
  }

  if (redirectUrl) {
    return { token: null as string | null, redirect: redirectUrl }
  }

  return { token, redirect: null as string | null }
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
    return { token }
  },
  component: RootApp,
  shellComponent: RootDocument,
})

function RootApp() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL
  const { token } = Route.useRouteContext()

  if (!convexUrl) {
    throw new Error('Missing VITE_CONVEX_URL in environment')
  }

  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl])

  return (
    <ConvexAuthProvider convex={client} proxy="/api/auth" token={token}>
      <AppLayout />
    </ConvexAuthProvider>
  )
}

function AppLayout() {
  const user = useQuery(api.users.viewer)
  const userLabel = user?.name ?? user?.email ?? user?.phone ?? 'Anonymous'

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <header className="border-border/60 border-b backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="font-mono text-xs font-bold tracking-[0.2em] uppercase transition-colors hover:text-primary"
          >
            convex<span className="text-primary">/</span>auth
          </Link>
          <div className="flex items-center gap-3">
            <Authenticated>
              <UserMenu label={userLabel} />
            </Authenticated>
            <Unauthenticated>
              <a
                href="/login"
                className="text-muted-foreground hover:text-foreground font-mono text-[11px] tracking-wide uppercase transition-colors"
              >
                Sign in
              </a>
            </Unauthenticated>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <Outlet />
      </main>
      <footer className="border-border/40 border-t">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-6 py-4">
          <p className="text-muted-foreground/60 font-mono text-[10px] tracking-wide">
            @robelest/convex-auth
          </p>
        </div>
      </footer>
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
