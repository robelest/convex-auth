import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useEffect } from 'react'

import { api } from '@convex/_generated/api'
import { Chat } from '@/components/chat'
import { Authenticated, Unauthenticated } from '@/lib/auth'

export const Route = createFileRoute('/chat')({ component: ChatPage })

function ChatPage() {
  const viewer = useQuery(api.users.viewer)
  const viewerId = viewer?._id

  return (
    <>
      <Unauthenticated>
        <ClientRedirect to="/login" />
      </Unauthenticated>
      <Authenticated>
        {!viewerId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground font-mono text-xs animate-pulse">
              Loading...
            </p>
          </div>
        ) : (
          <Chat viewer={viewerId} />
        )}
      </Authenticated>
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
