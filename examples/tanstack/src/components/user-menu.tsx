import {
  RiLogoutBoxLine,
  RiSettings3Line,
  RiUser3Line,
} from '@remixicon/react'
import { useState } from 'react'

import { useAuthActions } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SettingsDialog } from '@/components/settings-dialog'

export function UserMenu({ label }: { label: string }) {
  const { signOut } = useAuthActions()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    if (typeof window !== 'undefined') {
      window.location.assign('/login')
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <div className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full text-xs font-semibold">
              {label.charAt(0).toUpperCase()}
            </div>
            <span className="hidden text-sm sm:inline">{label}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="gap-2 text-sm">
            <RiSettings3Line className="size-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void handleSignOut()} className="gap-2 text-sm">
            <RiLogoutBoxLine className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        label={label}
      />
    </>
  )
}
