import {
  RiCheckLine,
  RiFingerprintLine,
  RiLogoutBoxLine,
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

export function UserMenu({ label }: { label: string }) {
  const { signOut, passkey } = useAuthActions()
  const [passkeyStatus, setPasskeyStatus] = useState<
    'idle' | 'registering' | 'success' | 'error'
  >('idle')
  const [passkeyError, setPasskeyError] = useState<string | null>(null)

  const handleSignOut = async () => {
    await signOut()
    if (typeof window !== 'undefined') {
      window.location.assign('/login')
    }
  }

  const handleAddPasskey = async () => {
    setPasskeyStatus('registering')
    setPasskeyError(null)
    try {
      await passkey.register()
      setPasskeyStatus('success')
      setTimeout(() => setPasskeyStatus('idle'), 2500)
    } catch (error) {
      console.error('Passkey registration failed:', error)
      setPasskeyError(
        error instanceof Error ? error.message : 'Registration failed',
      )
      setPasskeyStatus('error')
      setTimeout(() => {
        setPasskeyStatus('idle')
        setPasskeyError(null)
      }, 3000)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="shrink-0">
          <RiUser3Line className="size-4" />
          <span className="sr-only">Open user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-mono text-[11px] font-normal tracking-wide">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {passkey.isSupported() && (
          <DropdownMenuItem
            onClick={() => void handleAddPasskey()}
            disabled={passkeyStatus === 'registering'}
            className="gap-2 font-mono text-[11px]"
          >
            {passkeyStatus === 'success' ? (
              <RiCheckLine className="text-primary size-4" />
            ) : (
              <RiFingerprintLine className="size-4" />
            )}
            {passkeyStatus === 'idle' && 'Add passkey'}
            {passkeyStatus === 'registering' && 'Waiting...'}
            {passkeyStatus === 'success' && 'Passkey added'}
            {passkeyStatus === 'error' && (passkeyError ?? 'Failed')}
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onClick={() => void handleSignOut()}
          className="gap-2 font-mono text-[11px]"
        >
          <RiLogoutBoxLine className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
