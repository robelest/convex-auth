import { api } from '@convex/_generated/api'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useRef, useState } from 'react'

import { AppSidebar } from '@/components/app-sidebar'
import { Chat } from '@/components/chat'
import { useAuthState } from '@/lib/auth'

export const Route = createFileRoute('/_authenticated/chat')({
  validateSearch: (search: Record<string, unknown>) => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
    groupId: typeof search.groupId === 'string' ? search.groupId : undefined,
  }),
  component: ChatPage,
})

function ChatPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const acceptInvite = useMutation(api.invites.acceptToken)
  const { isAuthenticated, isLoading, token } = useAuthState()
  const shouldRunProtectedQueries = isAuthenticated || token !== null

  const viewer = useQuery(
    api.users.viewer,
    shouldRunProtectedQueries ? {} : 'skip',
  )
  const myGroups = useQuery(
    api.groups.list,
    shouldRunProtectedQueries ? {} : 'skip',
  )

  const viewerId = viewer?._id
  const [activeGroupId, setActiveGroupId] = useState<string | null>(
    search.groupId ?? null,
  )
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteAccepting, setInviteAccepting] = useState(false)
  const lastProcessedInviteRef = useRef<string | null>(null)

  useEffect(() => {
    setActiveGroupId(search.groupId ?? null)
  }, [search.groupId])

  useEffect(() => {
    if (!search.invite) {
      lastProcessedInviteRef.current = null
    }
  }, [search.invite])

  useEffect(() => {
    if (!shouldRunProtectedQueries || !search.invite) {
      return
    }

    if (lastProcessedInviteRef.current === search.invite) {
      return
    }

    lastProcessedInviteRef.current = search.invite
    let cancelled = false

    void (async () => {
      setInviteAccepting(true)
      setInviteError(null)
      try {
        const result = await acceptInvite({ token: search.invite! })
        if (cancelled) {
          return
        }
        const nextGroupId = result.groupId ?? search.groupId ?? null
        setActiveGroupId(nextGroupId)
        await navigate({
          to: '/chat',
          search: nextGroupId ? { groupId: nextGroupId } : {},
          replace: true,
        })
      } catch (error) {
        if (cancelled) {
          return
        }
        setInviteError(
          error instanceof Error
            ? error.message
            : 'Could not accept invite link',
        )
      } finally {
        if (!cancelled) {
          setInviteAccepting(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    acceptInvite,
    navigate,
    search.groupId,
    search.invite,
    shouldRunProtectedQueries,
  ])

  if (isLoading && token === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm animate-pulse">
          Checking session...
        </p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        search={{ redirectTo: buildChatHref(search) }}
        replace
      />
    )
  }

  // Resolve channel name
  const channelName =
    activeGroupId === null
      ? 'general'
      : (myGroups?.find((g) => g._id === activeGroupId)?.name ?? 'channel')

  if (inviteAccepting) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm animate-pulse">
          Accepting invite...
        </p>
      </div>
    )
  }

  if (!viewerId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm animate-pulse">
          Loading...
        </p>
      </div>
    )
  }

  return (
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
  )
}

function buildChatHref(search: { invite?: string; groupId?: string }) {
  const params = new URLSearchParams()
  if (search.invite) {
    params.set('invite', search.invite)
  }
  if (search.groupId) {
    params.set('groupId', search.groupId)
  }
  const query = params.toString()
  return query.length > 0 ? `/chat?${query}` : '/chat'
}
