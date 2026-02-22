import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '@convex/_generated/api'
import { Chat } from '@/components/chat'
import { AppSidebar } from '@/components/app-sidebar'
import { Authenticated, Unauthenticated, useAuthState } from '@/lib/auth'

export const Route = createFileRoute('/chat')({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    groupId: typeof search.groupId === 'string' ? search.groupId : undefined,
  }),
  component: ChatPage,
})

function ChatPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/chat' })
  const acceptInvite = useMutation(api.invites.acceptToken)
  const { isAuthenticated } = useAuthState()

  const viewer = useQuery(api.users.viewer)
  const viewerId = viewer?._id
  const [activeGroupId, setActiveGroupId] = useState<string | null>(
    search.groupId ?? null,
  )
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteAccepting, setInviteAccepting] = useState(false)

  useEffect(() => {
    setActiveGroupId(search.groupId ?? null)
  }, [search.groupId])

  useEffect(() => {
    if (!isAuthenticated || !search.invite || inviteAccepting) {
      return
    }

    void (async () => {
      setInviteAccepting(true)
      setInviteError(null)
      try {
        const result = await acceptInvite({ token: search.invite! })
        const nextGroupId = result.groupId ?? search.groupId ?? null
        setActiveGroupId(nextGroupId)
        await navigate({
          to: '/chat',
          search: nextGroupId ? { groupId: nextGroupId } : {},
          replace: true,
        })
      } catch (error) {
        setInviteError(
          error instanceof Error
            ? error.message
            : 'Could not accept invite link',
        )
      } finally {
        setInviteAccepting(false)
      }
    })()
  }, [
    acceptInvite,
    inviteAccepting,
    isAuthenticated,
    navigate,
    search.groupId,
    search.invite,
  ])

  // Resolve channel name
  const myGroups = useQuery(api.groups.list)
  const channelName =
    activeGroupId === null
      ? 'general'
      : myGroups?.find((g) => g._id === activeGroupId)?.name ?? 'channel'

  const loginTarget = search.invite
    ? `/login?invite=${encodeURIComponent(search.invite)}`
    : '/login'

  return (
    <>
      <Unauthenticated>
        <ClientRedirect to={loginTarget} />
      </Unauthenticated>
      <Authenticated>
        {inviteAccepting ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm animate-pulse">
              Accepting invite...
            </p>
          </div>
        ) : !viewerId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-muted-foreground text-sm animate-pulse">
              Loading...
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col">
            {inviteError && (
              <div className="bg-destructive/10 border-destructive/20 border-b px-4 py-2 text-xs text-destructive">
                {inviteError}
              </div>
            )}
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
