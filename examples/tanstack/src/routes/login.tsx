import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Authenticated, Unauthenticated } from 'convex/react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useAuthActions } from '@/lib/auth'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const { signIn } = useAuthActions()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await signIn('password', { email, password, flow })
      window.location.replace('/chat')
    } catch {
      const hint =
        flow === 'signIn'
          ? 'Could not sign in. You may need to switch to sign up.'
          : 'Could not sign up. You may already have an account.'
      setError(hint)
    } finally {
      setBusy(false)
    }
  }

  const handleAnonymous = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      await signIn('anonymous')
      window.location.replace('/chat')
    } catch {
      setError('Could not continue as a guest. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Authenticated>
        <ClientRedirect to="/chat" />
      </Authenticated>
      <Unauthenticated>
        <div className="mx-auto flex w-full max-w-md flex-1 items-center">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>
                Sign in with email and password, or continue as anonymous.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={flow === 'signIn' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  {flow === 'signIn' ? 'Sign in' : 'Sign up'}
                </Button>
              </form>
              {error ? <p className="text-destructive mt-3 text-xs">{error}</p> : null}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setFlow((currentFlow) =>
                    currentFlow === 'signIn' ? 'signUp' : 'signIn',
                  )
                }
                disabled={busy}
              >
                {flow === 'signIn'
                  ? "Don't have an account? Sign up"
                  : 'Already have an account? Sign in'}
              </Button>
              <Separator />
              <Button type="button" variant="secondary" onClick={() => void handleAnonymous()} disabled={busy}>
                Continue as anonymous
              </Button>
            </CardFooter>
          </Card>
        </div>
      </Unauthenticated>
    </>
  )
}

function ClientRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to)
  }, [to])

  return <p className="text-muted-foreground text-xs">Redirecting...</p>
}
