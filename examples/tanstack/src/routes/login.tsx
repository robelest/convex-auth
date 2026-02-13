import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  RiFingerprintLine,
  RiMailLine,
  RiShieldKeyholeLine,
  RiUserLine,
} from '@remixicon/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Authenticated, Unauthenticated, useAuthActions } from '@/lib/auth'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn')

  return (
    <>
      <Authenticated>
        <ClientRedirect to="/chat" />
      </Authenticated>
      <Unauthenticated>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            {/* Header */}
            <div className="mb-8 space-y-2">
              <h1 className="font-mono text-2xl font-bold tracking-tight">
                {flow === 'signIn' ? 'Welcome back' : 'Create account'}
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {flow === 'signIn'
                  ? 'Sign in to your account to continue.'
                  : 'Choose how you want to create your account.'}
              </p>
            </div>

            {/* Google OAuth */}
            <GoogleButton />

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="border-border w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background text-muted-foreground px-2 font-mono text-[11px] uppercase tracking-widest">
                  or
                </span>
              </div>
            </div>

            {/* Auth Tabs */}
            <Tabs defaultValue="password" className="w-full">
              <TabsList className="mb-6 grid w-full grid-cols-3">
                <TabsTrigger value="password" className="gap-1.5 font-mono text-[11px]">
                  <RiMailLine className="size-3.5" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="passkey" className="gap-1.5 font-mono text-[11px]">
                  <RiFingerprintLine className="size-3.5" />
                  Passkey
                </TabsTrigger>
                <TabsTrigger value="guest" className="gap-1.5 font-mono text-[11px]">
                  <RiUserLine className="size-3.5" />
                  Guest
                </TabsTrigger>
              </TabsList>

              <TabsContent value="password">
                <PasswordTab flow={flow} setFlow={setFlow} />
              </TabsContent>

              <TabsContent value="passkey">
                <PasskeyTab flow={flow} setFlow={setFlow} />
              </TabsContent>

              <TabsContent value="guest">
                <GuestTab />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </Unauthenticated>
    </>
  )
}

// ---------------------------------------------------------------------------
// Password tab
// ---------------------------------------------------------------------------

function PasswordTab({
  flow,
  setFlow,
}: {
  flow: 'signIn' | 'signUp'
  setFlow: (flow: 'signIn' | 'signUp') => void
}) {
  const { signIn, totp } = useAuthActions()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [totpStep, setTotpStep] = useState(false)
  const [totpVerifier, setTotpVerifier] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await signIn('password', { email, password, flow })
      if (result?.totpRequired) {
        setTotpStep(true)
        setTotpVerifier(result.verifier ?? null)
        setBusy(false)
        return
      }
      window.location.replace('/chat')
    } catch {
      setError(
        flow === 'signIn'
          ? 'Could not sign in. Check your credentials or switch to sign up.'
          : 'Could not sign up. You may already have an account.',
      )
    } finally {
      setBusy(false)
    }
  }

  const handleTotpVerify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !totpVerifier) return
    setBusy(true)
    setError(null)
    try {
      await totp.verify({ code: totpCode, verifier: totpVerifier })
      window.location.replace('/chat')
    } catch {
      setError('Invalid code. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (totpStep) {
    return (
      <div className="space-y-5">
        <div className="bg-muted/40 border-border flex flex-col items-center gap-4 border p-6">
          <div className="bg-primary/10 border-primary/20 flex size-14 items-center justify-center border">
            <RiShieldKeyholeLine className="text-primary size-7" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">Two-factor authentication</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Enter the 6-digit code from your authenticator app.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleTotpVerify}>
          <div className="space-y-2">
            <Label htmlFor="totp-code" className="font-mono text-[11px] tracking-wide uppercase">
              Verification code
            </Label>
            <Input
              id="totp-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="font-mono text-lg tracking-[0.3em] text-center"
              autoFocus
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full font-mono text-xs tracking-wide"
            disabled={busy || totpCode.length !== 6}
          >
            <RiShieldKeyholeLine className="size-4" />
            {busy ? 'Verifying...' : 'Verify'}
          </Button>
        </form>

        {error && (
          <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px]">
            {error}
          </p>
        )}

        <div className="border-border/60 border-t pt-4">
          <button
            type="button"
            onClick={() => {
              setTotpStep(false)
              setTotpVerifier(null)
              setTotpCode('')
              setError(null)
            }}
            className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email" className="font-mono text-[11px] tracking-wide uppercase">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password" className="font-mono text-[11px] tracking-wide uppercase">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder={flow === 'signUp' ? 'Create a password' : 'Enter password'}
            autoComplete={flow === 'signIn' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" className="w-full font-mono text-xs tracking-wide" disabled={busy}>
          {busy ? 'Please wait...' : flow === 'signIn' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      {error && (
        <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px]">
          {error}
        </p>
      )}

      <div className="border-border/60 border-t pt-4">
        <button
          type="button"
          onClick={() => setFlow(flow === 'signIn' ? 'signUp' : 'signIn')}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
        >
          {flow === 'signIn'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Passkey tab
// ---------------------------------------------------------------------------

function PasskeyTab({
  flow,
  setFlow,
}: {
  flow: 'signIn' | 'signUp'
  setFlow: (flow: 'signIn' | 'signUp') => void
}) {
  const { signIn, passkey } = useAuthActions()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [supported, setSupported] = useState(false)
  const [step, setStep] = useState<'form' | 'registering'>('form')

  useEffect(() => {
    setSupported(passkey.isSupported())
  }, [passkey])

  // Sign in: authenticate with existing passkey
  const handleAuth = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await passkey.authenticate()
      if (result.signingIn) {
        window.location.replace('/chat')
      }
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('cancelled')
          ? 'Authentication was cancelled.'
          : 'Could not authenticate with passkey.',
      )
    } finally {
      setBusy(false)
    }
  }

  // Sign up: create account with email, then immediately register passkey
  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || !email.trim()) return
    setBusy(true)
    setError(null)
    try {
      // Step 1: Create account with a random password (user never sees it)
      const tempPassword = crypto.randomUUID() + crypto.randomUUID()
      setStep('registering')
      await signIn('password', { email, password: tempPassword, flow: 'signUp' })

      // Step 2: Now authenticated — register a passkey
      await passkey.register({ email, userName: email })

      window.location.replace('/chat')
    } catch (e) {
      setStep('form')
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('cancelled')) {
        setError('Passkey registration was cancelled. Your account was created — you can add a passkey later from settings.')
      } else if (msg.includes('already')) {
        setError('An account with this email already exists. Try signing in instead.')
      } else {
        setError('Could not create account. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <div className="space-y-4">
        <div className="bg-muted/60 border-border flex flex-col items-center gap-3 border p-8">
          <RiShieldKeyholeLine className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-center text-sm">
            Passkeys are not supported in this browser. Try Chrome, Safari, or Edge.
          </p>
        </div>
      </div>
    )
  }

  // Sign-up mode: email + passkey registration
  if (flow === 'signUp') {
    return (
      <div className="space-y-5">
        <div className="bg-muted/40 border-border flex flex-col items-center gap-4 border p-6">
          <div className="bg-primary/10 border-primary/20 flex size-14 items-center justify-center border">
            <RiFingerprintLine className="text-primary size-7" />
          </div>
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium">Passwordless account</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Enter your email, then register a passkey. No password needed.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSignUp}>
          <div className="space-y-2">
            <Label htmlFor="passkey-email" className="font-mono text-[11px] tracking-wide uppercase">
              Email
            </Label>
            <Input
              id="passkey-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={step === 'registering'}
            />
          </div>

          <Button
            type="submit"
            className="w-full font-mono text-xs tracking-wide"
            disabled={busy}
          >
            <RiFingerprintLine className="size-4" />
            {step === 'registering'
              ? 'Complete passkey registration...'
              : 'Create account with passkey'}
          </Button>
        </form>

        {error && (
          <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px] leading-relaxed">
            {error}
          </p>
        )}

        <div className="border-border/60 border-t pt-4">
          <button
            type="button"
            onClick={() => setFlow('signIn')}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
          >
            Already have an account? Sign in
          </button>
        </div>
      </div>
    )
  }

  // Sign-in mode: authenticate with existing passkey
  return (
    <div className="space-y-5">
      <div className="bg-muted/40 border-border flex flex-col items-center gap-4 border p-8">
        <div className="bg-primary/10 border-primary/20 flex size-16 items-center justify-center border">
          <RiFingerprintLine className="text-primary size-8" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium">Passwordless sign in</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Use your fingerprint, face, or security key to authenticate instantly.
          </p>
        </div>
      </div>

      <Button
        type="button"
        className="w-full font-mono text-xs tracking-wide"
        onClick={() => void handleAuth()}
        disabled={busy}
      >
        <RiFingerprintLine className="size-4" />
        {busy ? 'Waiting for authenticator...' : 'Sign in with passkey'}
      </Button>

      {error && (
        <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px]">
          {error}
        </p>
      )}

      <div className="border-border/60 border-t pt-4">
        <button
          type="button"
          onClick={() => setFlow('signUp')}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground w-full text-center font-mono text-[11px] tracking-wide transition-colors"
        >
          Don't have an account? Sign up
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Guest tab
// ---------------------------------------------------------------------------

function GuestTab() {
  const { signIn } = useAuthActions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleGuest = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn('anonymous')
      window.location.replace('/chat')
    } catch {
      setError('Could not continue as guest. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-muted/40 border-border flex flex-col items-center gap-4 border p-8">
        <div className="bg-secondary flex size-16 items-center justify-center border">
          <RiUserLine className="text-muted-foreground size-8" />
        </div>
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium">Continue as guest</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            No account needed. Jump straight in. Your data won't persist across sessions.
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full font-mono text-xs tracking-wide"
        onClick={() => void handleGuest()}
        disabled={busy}
      >
        {busy ? 'Setting up...' : 'Continue as guest'}
      </Button>

      {error && (
        <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px]">
          {error}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Google OAuth button
// ---------------------------------------------------------------------------

function GoogleButton() {
  const { signIn } = useAuthActions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleGoogle = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await signIn('google')
    } catch {
      setError('Could not sign in with Google. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2 font-mono text-xs tracking-wide"
        onClick={() => void handleGoogle()}
        disabled={busy}
      >
        <svg className="size-4" viewBox="0 0 24 24">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        {busy ? 'Redirecting...' : 'Continue with Google'}
      </Button>

      {error && (
        <p className="bg-destructive/10 text-destructive border-destructive/20 border px-3 py-2 font-mono text-[11px]">
          {error}
        </p>
      )}
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
    <p className="text-muted-foreground font-mono text-xs">Redirecting...</p>
  )
}
