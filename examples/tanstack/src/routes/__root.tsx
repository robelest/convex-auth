import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Authenticated, ConvexReactClient, Unauthenticated, useQuery } from 'convex/react'
import { useMemo } from 'react'

import appCss from '../styles.css?url'
import { api } from '@convex/_generated/api'
import { UserMenu } from '@/components/user-menu'
import { ConvexAuthProvider } from '@/lib/auth'

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
  component: RootApp,
  shellComponent: RootDocument,
})

function RootApp() {
  const convexUrl = import.meta.env.VITE_CONVEX_URL

  if (!convexUrl) {
    throw new Error('Missing VITE_CONVEX_URL in environment')
  }

  const client = useMemo(() => new ConvexReactClient(convexUrl), [convexUrl])

  return (
    <ConvexAuthProvider client={client} shouldHandleCode={false}>
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
