import {
  RiCheckLine,
  RiFingerprintLine,
  RiLogoutBoxLine,
  RiShieldKeyholeLine,
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
  const { signOut, passkey, totp } = useAuthActions()
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

  const [totpStatus, setTotpStatus] = useState<
    'idle' | 'setup' | 'confirming' | 'success' | 'error'
  >('idle')
  const [totpError, setTotpError] = useState<string | null>(null)
  const [totpSetupData, setTotpSetupData] = useState<{
    uri: string
    secret: string
    verifier: string
    totpId: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState('')

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

  const handleEnableTotp = async () => {
    setTotpStatus('setup')
    setTotpError(null)
    try {
      const data = await totp.setup()
      setTotpSetupData(data)
    } catch (error) {
      console.error('TOTP setup failed:', error)
      setTotpError(error instanceof Error ? error.message : 'Setup failed')
      setTotpStatus('error')
      setTimeout(() => {
        setTotpStatus('idle')
        setTotpError(null)
      }, 3000)
    }
  }

  const handleConfirmTotp = async () => {
    if (!totpSetupData || !totpCode.trim()) return
    setTotpStatus('confirming')
    setTotpError(null)
    try {
      await totp.confirm({
        code: totpCode,
        verifier: totpSetupData.verifier,
        totpId: totpSetupData.totpId,
      })
      setTotpStatus('success')
      setTotpSetupData(null)
      setTotpCode('')
      setTimeout(() => setTotpStatus('idle'), 2500)
    } catch (error) {
      console.error('TOTP confirm failed:', error)
      setTotpError(error instanceof Error ? error.message : 'Invalid code')
      setTotpStatus('setup') // Go back to setup state so they can retry
    }
  }

  const handleCancelTotp = () => {
    setTotpStatus('idle')
    setTotpSetupData(null)
    setTotpCode('')
    setTotpError(null)
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

        {/* TOTP 2FA */}
        {totpStatus !== 'setup' && !totpSetupData && (
          <DropdownMenuItem
            onClick={() => void handleEnableTotp()}
            disabled={totpStatus === 'confirming'}
            className="gap-2 font-mono text-[11px]"
          >
            {totpStatus === 'success' ? (
              <RiCheckLine className="text-primary size-4" />
            ) : (
              <RiShieldKeyholeLine className="size-4" />
            )}
            {totpStatus === 'idle' && 'Enable 2FA'}
            {totpStatus === 'confirming' && 'Verifying...'}
            {totpStatus === 'success' && '2FA enabled'}
            {totpStatus === 'error' && (totpError ?? 'Failed')}
          </DropdownMenuItem>
        )}

        {totpSetupData && (
          <div className="px-2 py-2 space-y-3">
            <div className="space-y-1">
              <p className="font-mono text-[11px] font-medium tracking-wide">Setup 2FA</p>
              <p className="text-muted-foreground text-[10px] leading-relaxed">
                Add this key to your authenticator app:
              </p>
            </div>
            <div className="bg-muted border-border overflow-hidden border px-2 py-1.5">
              <code className="font-mono text-[10px] break-all select-all">
                {totpSetupData.secret}
              </code>
            </div>
            {totpError && (
              <p className="text-destructive font-mono text-[10px]">{totpError}</p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="bg-input border-border h-7 flex-1 border px-2 font-mono text-[11px] tracking-[0.3em] placeholder:tracking-[0.3em]"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void handleConfirmTotp()}
                disabled={totpCode.length !== 6 || totpStatus === 'confirming'}
                className="bg-primary text-primary-foreground disabled:opacity-50 h-7 px-3 font-mono text-[10px] font-medium tracking-wide"
              >
                {totpStatus === 'confirming' ? '...' : 'Verify'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleCancelTotp}
              className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[10px] tracking-wide transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        <DropdownMenuSeparator />

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
