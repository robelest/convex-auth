import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useSearch } from '@tanstack/react-router'
import { RiDeviceLine, RiCheckLine } from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Authenticated,
  Unauthenticated,
  useAuthActions,
} from '@/lib/auth'

export const Route = createFileRoute('/device')({
  validateSearch: (search: Record<string, unknown>) => ({
    user_code: (search.user_code as string) ?? '',
  }),
  component: DevicePage,
})

function DevicePage() {
  return (
    <>
      <Authenticated>
        <DeviceVerification />
      </Authenticated>
      <Unauthenticated>
        <ClientRedirect to="/login" />
      </Unauthenticated>
    </>
  )
}

// ---------------------------------------------------------------------------
// Device verification form
// ---------------------------------------------------------------------------

function DeviceVerification() {
  const { device } = useAuthActions()
  const { user_code: prefilled } = useSearch({ from: '/device' })

  // Split into two 4-char segments for the input UX
  const [left, setLeft] = useState(() => prefilled.replace(/-/g, '').slice(0, 4).toUpperCase())
  const [right, setRight] = useState(() => prefilled.replace(/-/g, '').slice(4, 8).toUpperCase())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)

  const rightRef = useRef<HTMLInputElement>(null)
  const charset = 'BCDFGHJKLMNPQRSTVWXZ'

  const filterInput = (value: string) =>
    value
      .toUpperCase()
      .split('')
      .filter((c) => charset.includes(c))
      .join('')
      .slice(0, 4)

  // Auto-submit if prefilled with a complete code
  const hasAutoSubmitted = useRef(false)
  useEffect(() => {
    if (
      !hasAutoSubmitted.current &&
      prefilled.replace(/-/g, '').length === 8 &&
      left.length === 4 &&
      right.length === 4
    ) {
      hasAutoSubmitted.current = true
      void handleSubmit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault()
    if (busy || left.length !== 4 || right.length !== 4) return
    setBusy(true)
    setError(null)
    try {
      await device.verify(`${left}-${right}`)
      setSuccess(true)
    } catch {
      setError('Invalid or expired code. Please check and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (success) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm space-y-6">
          <div className="bg-muted/40 border-border flex flex-col items-center gap-4 border p-8">
            <div className="bg-primary/10 border-primary/20 flex size-16 items-center justify-center border">
              <RiCheckLine className="text-primary size-8" />
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium">Device authorized</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Your device has been signed in. You can close this page.
              </p>
            </div>
          </div>

          <div className="border-border/60 border-t pt-4">
            <button
              type="button"
              onClick={() => window.location.replace('/chat')}
              className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
            >
              Go to chat
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 space-y-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight">
            Authorize device
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Enter the code shown on your device to sign it in.
          </p>
        </div>

        {/* Hero icon */}
        <div className="bg-muted/40 border-border mb-6 flex flex-col items-center gap-4 border p-6">
          <div className="bg-primary/10 border-primary/20 flex size-14 items-center justify-center border">
            <RiDeviceLine className="text-primary size-7" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">Device sign-in</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              A device is requesting access to your account.
            </p>
          </div>
        </div>

        {/* Code input */}
        <form className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <div className="space-y-2">
            <Label
              htmlFor="code-left"
              className="font-mono text-[11px] tracking-wide uppercase"
            >
              Device code
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="code-left"
                type="text"
                inputMode="text"
                maxLength={4}
                placeholder="XXXX"
                value={left}
                onChange={(e) => {
                  const v = filterInput(e.target.value)
                  setLeft(v)
                  if (v.length === 4) rightRef.current?.focus()
                }}
                className="font-mono text-lg tracking-[0.3em] text-center"
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-muted-foreground font-mono text-lg">
                -
              </span>
              <Input
                id="code-right"
                ref={rightRef}
                type="text"
                inputMode="text"
                maxLength={4}
                placeholder="XXXX"
                value={right}
                onChange={(e) => setRight(filterInput(e.target.value))}
                onKeyDown={(e) => {
                  if (
                    e.key === 'Backspace' &&
                    right.length === 0
                  ) {
                    document.getElementById('code-left')?.focus()
                  }
                }}
                className="font-mono text-lg tracking-[0.3em] text-center"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full font-mono text-xs tracking-wide"
            disabled={busy || left.length !== 4 || right.length !== 4}
          >
            <RiDeviceLine className="size-4" />
            {busy ? 'Verifying...' : 'Authorize device'}
          </Button>
        </form>

        {error && (
          <p className="bg-destructive/10 text-destructive border-destructive/20 mt-4 border px-3 py-2 font-mono text-[11px]">
            {error}
          </p>
        )}

        <div className="border-border/60 mt-5 border-t pt-4">
          <button
            type="button"
            onClick={() => window.location.replace('/chat')}
            className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
          >
            Cancel and go to chat
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Redirect helper
// ---------------------------------------------------------------------------

function ClientRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])
  return (
    <p className="text-muted-foreground font-mono text-xs animate-pulse">
      Redirecting...
    </p>
  )
}
