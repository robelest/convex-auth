import { createFileRoute } from '@tanstack/react-router'
import { Authenticated, Unauthenticated, useQuery } from 'convex/react'
import { useEffect } from 'react'

import { api } from '@convex/_generated/api'
import { Chat } from '@/components/chat'

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
          <p className="text-muted-foreground text-xs">Loading your profile...</p>
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

  return <p className="text-muted-foreground text-xs">Redirecting...</p>
}
