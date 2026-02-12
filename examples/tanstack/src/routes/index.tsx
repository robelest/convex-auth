import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { Authenticated, Unauthenticated, useAuthState } from '@/lib/auth'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  const { isLoading } = useAuthState()

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground font-mono text-xs animate-pulse">
          Checking session...
        </p>
      </div>
    )
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

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-muted-foreground font-mono text-xs animate-pulse">
        Redirecting...
      </p>
    </div>
  )
}
