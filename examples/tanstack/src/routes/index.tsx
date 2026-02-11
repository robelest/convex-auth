import { createFileRoute } from '@tanstack/react-router'
import { Authenticated, Unauthenticated, useConvexAuth } from 'convex/react'
import { useEffect } from 'react'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  const { isLoading } = useConvexAuth()

  if (isLoading) {
    return <p className="text-muted-foreground text-xs">Checking your session...</p>
  }

  return (
    <>
      <Authenticated>
        <ClientRedirect to="/chat" />
      </Authenticated>
      <Unauthenticated>
        <ClientRedirect to="/login" />
      </Unauthenticated>
    </>
  )
}

function ClientRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])

  return <p className="text-muted-foreground text-xs">Redirecting...</p>
}
