import { useState } from 'react'
import {
  RiAddLine,
  RiChat3Line,
  RiHashtag,
  RiLogoutBoxLine,
  RiSearchLine,
} from '@remixicon/react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@convex/_generated/api'

import { useAuthActions } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SettingsDialog } from '@/components/settings-dialog'
import { cn } from '@/lib/utils'

interface AppSidebarProps {
  activeGroupId: string | null
  onSelectGroup: (groupId: string | null) => void
}

export function AppSidebar({ activeGroupId, onSelectGroup }: AppSidebarProps) {
  const myGroups = useQuery(api.groups.list)
  const allGroups = useQuery(api.groups.listAll)
  const createGroup = useMutation(api.groups.create)
  const joinGroup = useMutation(api.groups.join)
  const viewer = useQuery(api.users.viewer)
  const { signOut } = useAuthActions()

  const userLabel = viewer?.name ?? viewer?.email ?? viewer?.phone ?? 'Anonymous'

  const [createOpen, setCreateOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      const groupId = await createGroup({ name: newName.trim() })
      setNewName('')
      setCreateOpen(false)
      onSelectGroup(groupId)
    } finally {
      setCreating(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    if (typeof window !== 'undefined') {
      window.location.assign('/login')
    }
  }

  const myGroupIds = new Set(myGroups?.map((g) => g._id) ?? [])

  const handleJoin = async (groupId: string) => {
    await joinGroup({ groupId })
    onSelectGroup(groupId)
    setBrowseOpen(false)
  }

  return (
    <aside className="border-border flex h-full w-60 shrink-0 flex-col border-r bg-sidebar">
      {/* Header */}
      <div className="border-border flex h-12 items-center justify-between border-b px-4">
        <span className="text-sm font-semibold text-sidebar-foreground">Channels</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
            onClick={() => setBrowseOpen(true)}
            title="Browse channels"
          >
            <RiSearchLine className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 text-sidebar-foreground/60 hover:text-sidebar-foreground"
            onClick={() => setCreateOpen(true)}
            title="Create channel"
          >
            <RiAddLine className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Channel list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {/* General channel (no groupId) */}
          <button
            type="button"
            onClick={() => onSelectGroup(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
              activeGroupId === null
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
            )}
          >
            <RiChat3Line className="size-4 shrink-0" />
            general
          </button>

          {/* User's groups */}
          {myGroups?.map((group) => (
            <button
              key={group._id}
              type="button"
              onClick={() => onSelectGroup(group._id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors',
                activeGroupId === group._id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
            >
              <RiHashtag className="size-4 shrink-0" />
              <span className="truncate">{group.name}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      {/* User — bottom of sidebar */}
      <div className="border-border flex h-14 items-center gap-2 border-t px-3">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 -m-1 transition-colors hover:bg-sidebar-accent/50"
          title="Settings"
        >
          <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {userLabel.charAt(0).toUpperCase()}
          </div>
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-sidebar-foreground">
            {userLabel}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="rounded-md p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/50 hover:text-destructive"
          title="Sign out"
        >
          <RiLogoutBoxLine className="size-4" />
        </button>
      </div>

      {/* Settings dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        label={userLabel}
      />

      {/* Create channel dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create channel</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              placeholder="Channel name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newName.trim() || creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Browse channels dialog */}
      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Browse channels</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-64">
            <div className="space-y-1">
              {allGroups?.map((group) => (
                <div
                  key={group._id}
                  className="flex items-center justify-between rounded-md px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <RiHashtag className="text-muted-foreground size-4" />
                    <span className="text-sm">{group.name}</span>
                  </div>
                  {myGroupIds.has(group._id) ? (
                    <span className="text-muted-foreground text-xs">Joined</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleJoin(group._id)}
                    >
                      Join
                    </Button>
                  )}
                </div>
              ))}
              {(!allGroups || allGroups.length === 0) && (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  No channels yet. Create one!
                </p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
