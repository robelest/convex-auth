import {
  RiCheckLine,
  RiClipboardLine,
  RiDeleteBinLine,
  RiFingerprintLine,
  RiKey2Line,
  RiLogoutBoxLine,
  RiShieldKeyholeLine,
  RiUser3Line,
} from '@remixicon/react'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
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

  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------
  const myKeys = useQuery(api.apikeys.listMyKeys)
  const createKey = useMutation(api.apikeys.createMyKey)
  const revokeKey = useMutation(api.apikeys.revokeMyKey)

  const [apiKeyStatus, setApiKeyStatus] = useState<
    'idle' | 'creating' | 'created' | 'error'
  >('idle')
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreateKey = async () => {
    setApiKeyStatus('creating')
    setApiKeyError(null)
    try {
      const { raw } = await createKey({ name: 'My API Key' })
      setNewRawKey(raw)
      setApiKeyStatus('created')
    } catch (error) {
      console.error('API key creation failed:', error)
      setApiKeyError(
        error instanceof Error ? error.message : 'Creation failed',
      )
      setApiKeyStatus('error')
      setTimeout(() => {
        setApiKeyStatus('idle')
        setApiKeyError(null)
      }, 3000)
    }
  }

  const handleCopyKey = async () => {
    if (!newRawKey) return
    await navigator.clipboard.writeText(newRawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDismissKey = () => {
    setNewRawKey(null)
    setApiKeyStatus('idle')
    setCopied(false)
  }

  const handleRevokeKey = async (keyId: string) => {
    try {
      await revokeKey({ keyId })
    } catch (error) {
      console.error('API key revocation failed:', error)
    }
  }

  const activeKeys = myKeys?.filter(
    (k: { revoked: boolean }) => !k.revoked,
  ) ?? []

  // Build the curl example for a newly created key
  const siteUrl =
    typeof window !== 'undefined'
      ? import.meta.env.VITE_CONVEX_SITE_URL ?? ''
      : ''
  const curlExample = newRawKey
    ? `curl -X POST ${siteUrl}/api/messages \\
  -H "Authorization: Bearer ${newRawKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"body":"Hello from API key!"}'`
    : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="shrink-0">
          <RiUser3Line className="size-4" />
          <span className="sr-only">Open user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
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

        {/* ----------------------------------------------------------------- */}
        {/* API Keys                                                          */}
        {/* ----------------------------------------------------------------- */}

        {/* Newly created key — shown once */}
        {newRawKey ? (
          <div className="space-y-3 px-2 py-2">
            <div className="space-y-1">
              <p className="font-mono text-[11px] font-medium tracking-wide">
                API Key Created
              </p>
              <p className="text-muted-foreground text-[10px] leading-relaxed">
                Copy this key now — you won't see it again.
              </p>
            </div>
            <div className="bg-muted border-border overflow-hidden border px-2 py-1.5">
              <code className="font-mono text-[10px] break-all select-all">
                {newRawKey}
              </code>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopyKey()}
                className="bg-primary text-primary-foreground flex h-7 flex-1 items-center justify-center gap-1.5 font-mono text-[10px] font-medium tracking-wide"
              >
                {copied ? (
                  <>
                    <RiCheckLine className="size-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <RiClipboardLine className="size-3" />
                    Copy
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleDismissKey}
                className="text-muted-foreground hover:text-foreground h-7 px-3 font-mono text-[10px] tracking-wide transition-colors"
              >
                Done
              </button>
            </div>
            {curlExample && (
              <div className="space-y-1">
                <p className="text-muted-foreground text-[10px]">Test with curl:</p>
                <div className="bg-muted border-border overflow-x-auto border px-2 py-1.5">
                  <code className="font-mono text-[9px] whitespace-pre break-all select-all">
                    {curlExample}
                  </code>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Create button */}
            <DropdownMenuItem
              onClick={() => void handleCreateKey()}
              disabled={apiKeyStatus === 'creating'}
              className="gap-2 font-mono text-[11px]"
            >
              <RiKey2Line className="size-4" />
              {apiKeyStatus === 'idle' && 'Create API key'}
              {apiKeyStatus === 'creating' && 'Creating...'}
              {apiKeyStatus === 'error' && (apiKeyError ?? 'Failed')}
            </DropdownMenuItem>

            {/* Active keys list */}
            {activeKeys.length > 0 && (
              <div className="px-2 py-1.5">
                <p className="text-muted-foreground mb-1.5 font-mono text-[10px] tracking-wide">
                  Active keys ({activeKeys.length})
                </p>
                <div className="space-y-1">
                  {activeKeys.map((k: { _id: string; name: string; prefix: string }) => (
                    <div
                      key={k._id}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[10px] font-medium">
                          {k.name}
                        </p>
                        <p className="text-muted-foreground font-mono text-[9px]">
                          {k.prefix}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevokeKey(k._id)}
                        className="text-muted-foreground hover:text-destructive shrink-0 p-1 transition-colors"
                        title="Revoke key"
                      >
                        <RiDeleteBinLine className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
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
