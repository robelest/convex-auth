import { useState } from 'react'
import {
  RiCheckLine,
  RiClipboardLine,
  RiDeleteBinLine,
  RiFingerprintLine,
  RiKey2Line,
  RiMoonLine,
  RiPaletteLine,
  RiShieldKeyholeLine,
  RiSunLine,
  RiUser3Line,
  RiComputerLine,
} from '@remixicon/react'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'

import { useAuthActions } from '@/lib/auth'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type SettingsTab = 'profile' | 'security' | 'api-keys' | 'appearance'

const tabs: { id: SettingsTab; label: string; icon: typeof RiUser3Line }[] = [
  { id: 'profile', label: 'Profile', icon: RiUser3Line },
  { id: 'security', label: 'Security', icon: RiShieldKeyholeLine },
  { id: 'api-keys', label: 'API Keys', icon: RiKey2Line },
  { id: 'appearance', label: 'Appearance', icon: RiPaletteLine },
]

export function SettingsDialog({
  open,
  onOpenChange,
  label,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] gap-0 overflow-hidden p-0" showCloseButton={false}>
        <div className="flex h-[600px]">
          {/* Sidebar nav */}
          <nav className="border-border flex w-56 shrink-0 flex-col border-r bg-muted/30 p-3">
            <DialogHeader className="px-3 pb-3 pt-2">
              <DialogTitle className="text-sm font-semibold">Settings</DialogTitle>
            </DialogHeader>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  activeTab === tab.id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-8">
            {activeTab === 'profile' && <ProfileTab label={label} />}
            {activeTab === 'security' && <SecurityTab />}
            {activeTab === 'api-keys' && <ApiKeysTab />}
            {activeTab === 'appearance' && <AppearanceTab />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Profile Tab
// ---------------------------------------------------------------------------

function ProfileTab({ label }: { label: string }) {
  const viewer = useQuery(api.users.viewer)
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Profile</h3>
        <p className="text-muted-foreground mt-1 text-xs">Your account information.</p>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full text-lg font-semibold">
            {label.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-medium">{label}</p>
            {viewer?.email && (
              <p className="text-muted-foreground text-xs">{viewer.email}</p>
            )}
            {viewer?.phone && (
              <p className="text-muted-foreground text-xs">{viewer.phone}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Security Tab — Passkey + TOTP
// ---------------------------------------------------------------------------

function SecurityTab() {
  const { passkey, totp } = useAuthActions()
  const [passkeyStatus, setPasskeyStatus] = useState<'idle' | 'registering' | 'success' | 'error'>('idle')
  const [passkeyError, setPasskeyError] = useState<string | null>(null)

  const [totpStatus, setTotpStatus] = useState<'idle' | 'setup' | 'confirming' | 'success' | 'error'>('idle')
  const [totpError, setTotpError] = useState<string | null>(null)
  const [totpSetupData, setTotpSetupData] = useState<{
    uri: string; secret: string; verifier: string; totpId: string
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
      setPasskeyError(error instanceof Error ? error.message : 'Registration failed')
      setPasskeyStatus('error')
      setTimeout(() => { setPasskeyStatus('idle'); setPasskeyError(null) }, 3000)
    }
  }

  const handleEnableTotp = async () => {
    setTotpStatus('setup')
    setTotpError(null)
    try {
      const data = await totp.setup()
      setTotpSetupData(data)
    } catch (error) {
      setTotpError(error instanceof Error ? error.message : 'Setup failed')
      setTotpStatus('error')
      setTimeout(() => { setTotpStatus('idle'); setTotpError(null) }, 3000)
    }
  }

  const handleConfirmTotp = async () => {
    if (!totpSetupData || !totpCode.trim()) return
    setTotpStatus('confirming')
    setTotpError(null)
    try {
      await totp.confirm({ code: totpCode, verifier: totpSetupData.verifier, totpId: totpSetupData.totpId })
      setTotpStatus('success')
      setTotpSetupData(null)
      setTotpCode('')
      setTimeout(() => setTotpStatus('idle'), 2500)
    } catch (error) {
      setTotpError(error instanceof Error ? error.message : 'Invalid code')
      setTotpStatus('setup')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Security</h3>
        <p className="text-muted-foreground mt-1 text-xs">Manage passkeys and two-factor authentication.</p>
      </div>

      {/* Passkey */}
      {passkey.isSupported() && (
        <div className="border-border rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RiFingerprintLine className="text-muted-foreground size-5" />
              <div>
                <p className="text-sm font-medium">Passkey</p>
                <p className="text-muted-foreground text-xs">Use biometrics or a security key.</p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAddPasskey()}
              disabled={passkeyStatus === 'registering'}
            >
              {passkeyStatus === 'success' && <><RiCheckLine className="size-3.5" /> Added</>}
              {passkeyStatus === 'registering' && 'Waiting...'}
              {passkeyStatus === 'idle' && 'Add passkey'}
              {passkeyStatus === 'error' && (passkeyError ?? 'Failed')}
            </Button>
          </div>
        </div>
      )}

      {/* TOTP */}
      <div className="border-border rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RiShieldKeyholeLine className="text-muted-foreground size-5" />
            <div>
              <p className="text-sm font-medium">Two-factor (TOTP)</p>
              <p className="text-muted-foreground text-xs">Authenticator app codes.</p>
            </div>
          </div>
          {!totpSetupData && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleEnableTotp()}
              disabled={totpStatus === 'confirming'}
            >
              {totpStatus === 'success' && <><RiCheckLine className="size-3.5" /> Enabled</>}
              {totpStatus === 'idle' && 'Enable'}
              {totpStatus === 'error' && (totpError ?? 'Failed')}
              {totpStatus === 'confirming' && 'Verifying...'}
              {totpStatus === 'setup' && !totpSetupData && 'Setting up...'}
            </Button>
          )}
        </div>

        {totpSetupData && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <p className="text-muted-foreground text-xs">Add this key to your authenticator app:</p>
            <div className="bg-muted rounded-md px-3 py-2">
              <code className="font-mono text-xs break-all select-all">{totpSetupData.secret}</code>
            </div>
            {totpError && <p className="text-destructive text-xs">{totpError}</p>}
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="bg-input border-border h-8 flex-1 rounded-md border px-3 font-mono text-sm tracking-[0.3em] placeholder:tracking-[0.3em]"
                autoFocus
              />
              <Button size="sm" onClick={() => void handleConfirmTotp()} disabled={totpCode.length !== 6 || totpStatus === 'confirming'}>
                Verify
              </Button>
            </div>
            <button
              type="button"
              onClick={() => { setTotpStatus('idle'); setTotpSetupData(null); setTotpCode(''); setTotpError(null) }}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// API Keys Tab
// ---------------------------------------------------------------------------

function ApiKeysTab() {
  const myKeys = useQuery(api.apikeys.listMyKeys)
  const createKey = useMutation(api.apikeys.createMyKey)
  const revokeKey = useMutation(api.apikeys.revokeMyKey)

  const [status, setStatus] = useState<'idle' | 'creating' | 'created' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [newRawKey, setNewRawKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleCreate = async () => {
    setStatus('creating')
    setError(null)
    try {
      const { raw } = await createKey({ name: 'My API Key' })
      setNewRawKey(raw)
      setStatus('created')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creation failed')
      setStatus('error')
      setTimeout(() => { setStatus('idle'); setError(null) }, 3000)
    }
  }

  const handleCopy = async () => {
    if (!newRawKey) return
    await navigator.clipboard.writeText(newRawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDismiss = () => { setNewRawKey(null); setStatus('idle'); setCopied(false) }

  const activeKeys = myKeys?.filter((k: { revoked: boolean }) => !k.revoked) ?? []

  const siteUrl = typeof window !== 'undefined' ? import.meta.env.VITE_CONVEX_SITE_URL ?? '' : ''
  const curlExample = newRawKey
    ? `curl -X POST ${siteUrl}/api/messages \\\n  -H "Authorization: Bearer ${newRawKey}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"body":"Hello from API key!"}'`
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">API Keys</h3>
          <p className="text-muted-foreground mt-1 text-xs">Create and manage API keys for programmatic access.</p>
        </div>
        {!newRawKey && (
          <Button size="sm" onClick={() => void handleCreate()} disabled={status === 'creating'}>
            <RiKey2Line className="size-3.5" />
            {status === 'creating' ? 'Creating...' : 'Create key'}
          </Button>
        )}
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      {/* Newly created key */}
      {newRawKey && (
        <div className="border-border rounded-lg border bg-muted/30 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Key created</p>
            <p className="text-muted-foreground text-xs">Copy this key now — you won't see it again.</p>
          </div>
          <div className="bg-muted rounded-md px-3 py-2">
            <code className="font-mono text-xs break-all select-all">{newRawKey}</code>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
              {copied ? <><RiCheckLine className="size-3.5" /> Copied</> : <><RiClipboardLine className="size-3.5" /> Copy</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDismiss}>Done</Button>
          </div>
          {curlExample && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Test with curl:</p>
              <div className="bg-muted rounded-md px-3 py-2 overflow-x-auto">
                <code className="font-mono text-[10px] whitespace-pre select-all">{curlExample}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active keys list */}
      {activeKeys.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">Active keys ({activeKeys.length})</p>
          {activeKeys.map((k: { _id: string; name: string; prefix: string }) => (
            <div key={k._id} className="border-border flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{k.name}</p>
                <p className="text-muted-foreground font-mono text-xs">{k.prefix}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => void revokeKey({ keyId: k._id })}
              >
                <RiDeleteBinLine className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {activeKeys.length === 0 && !newRawKey && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center">
          <RiKey2Line className="size-8 opacity-30" />
          <p className="text-xs">No API keys yet.</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance Tab
// ---------------------------------------------------------------------------

function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  const options: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof RiSunLine }[] = [
    { value: 'light', label: 'Light', icon: RiSunLine },
    { value: 'dark', label: 'Dark', icon: RiMoonLine },
    { value: 'system', label: 'System', icon: RiComputerLine },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Appearance</h3>
        <p className="text-muted-foreground mt-1 text-xs">Customize the look and feel.</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">Theme</p>
        <div className="grid grid-cols-3 gap-2">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={cn(
                'flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
                theme === opt.value
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
              )}
            >
              <opt.icon className="size-5" />
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
