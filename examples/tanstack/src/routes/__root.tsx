import {
  HeadContent,
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
import { ConvexReactClient } from 'convex/react'
import { useMemo } from 'react'

import appCss from '../styles.css?url'
import { ConvexAuthProvider } from '@/lib/auth'
import { ThemeProvider } from '@/lib/theme'
import { TooltipProvider } from '@/components/ui/tooltip'

// ---------------------------------------------------------------------------
// Server function: runs during SSR to refresh tokens, handle OAuth code
// exchange, and provide the JWT for flash-free client hydration.
// ---------------------------------------------------------------------------

const getAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const request = getRequest()
  const auth = server({ url: import.meta.env.VITE_CONVEX_URL! })

  const { cookies, redirect: redirectUrl, token } = await auth.refresh(request)

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
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Convex Auth' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
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
      <div className="bg-background flex h-screen overflow-hidden">
        <Outlet />
      </div>
    </ConvexAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ThemeProvider>
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
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
