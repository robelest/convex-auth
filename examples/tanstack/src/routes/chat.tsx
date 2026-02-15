import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '@convex/_generated/api'
import { Chat } from '@/components/chat'
import { AppSidebar } from '@/components/app-sidebar'
import { Authenticated, Unauthenticated } from '@/lib/auth'

export const Route = createFileRoute('/chat')({ component: ChatPage })

function ChatPage() {
  const viewer = useQuery(api.users.viewer)
  const viewerId = viewer?._id
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)

  // Resolve channel name
  const myGroups = useQuery(api.groups.list)
  const channelName =
    activeGroupId === null
      ? 'general'
      : myGroups?.find((g) => g._id === activeGroupId)?.name ?? 'channel'

  return (
    <>
      <Unauthenticated>
        <ClientRedirect to="/login" />
      </Unauthenticated>
      <Authenticated>
        {!viewerId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm animate-pulse">
              Loading...
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full">
            <AppSidebar
              activeGroupId={activeGroupId}
              onSelectGroup={setActiveGroupId}
            />
            <Chat
              viewer={viewerId}
              groupId={activeGroupId}
              channelName={channelName}
            />
          </div>
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
      <p className="text-muted-foreground text-sm animate-pulse">
        Redirecting...
      </p>
    </div>
  )
}
