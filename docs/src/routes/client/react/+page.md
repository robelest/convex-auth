---
title: React Hooks
description: useAuth() and ConvexAuthProvider for React apps.
---

<svelte:head>

  <title>React Hooks - convex-auth</title>
</svelte:head>

# React Hooks

`@robelest/convex-auth/react` wraps the imperative browser client with React
context and a single composite hook. Use it in React, Next.js, Vite, and
similar apps; it works in any React 18+ codebase.

`react` is **not** a declared peer dependency — if your app uses this
subpath, you already have React installed. Apps that only consume the
server entrypoints don't pay for React.

## Setup

```tsx
// app.tsx
import { ConvexReactClient } from "convex/react";
import { client as createAuthClient } from "@robelest/convex-auth/browser";
import { ConvexAuthProvider } from "@robelest/convex-auth/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
const auth = createAuthClient({ convex, url: convex.url });

export function Root() {
  return (
    <ConvexAuthProvider client={auth}>
      <App />
    </ConvexAuthProvider>
  );
}
```

Create the auth client at module scope so React's `StrictMode` double-mount
in development doesn't tear it down.

## `useAuth()`

Composite hook that returns everything you typically need:

```tsx
import { useAuth } from "@robelest/convex-auth/react";

function SignInButton() {
  const { isLoading, isAuthenticated, signIn, signOut } = useAuth();
  if (isLoading) return <span>Loading…</span>;
  return isAuthenticated ? (
    <button onClick={() => signOut()}>Sign out</button>
  ) : (
    <button onClick={() => signIn("google")}>Sign in with Google</button>
  );
}
```

Return shape:

| Field             | Type                                                               | Description                              |
| ----------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| `phase`           | `"loading" \| "handshake" \| "authenticated" \| "unauthenticated"` | High-level state for deterministic UI.   |
| `isLoading`       | `boolean`                                                          | True during initial hydration.           |
| `isAuthenticated` | `boolean`                                                          | True after Convex confirms backend auth. |
| `token`           | `string \| null`                                                   | Raw JWT, or `null`.                      |
| `signIn`          | `(provider, params?) => Promise<...>`                              | Start a provider sign-in flow.           |
| `signOut`         | `() => Promise<void>`                                              | Sign out + clear local state.            |

`useAuth()` subscribes to client state via `useSyncExternalStore`, so it's
SSR-safe — it returns a stable `loading` snapshot on the server.

## `useConvexAuthClient()`

Escape hatch when you need factor flows (`totp`, `passkey`, `device`) or
low-level methods (`completeOAuth`, `param`, `initialize`):

```tsx
import { useConvexAuthClient } from "@robelest/convex-auth/react";

function TotpSetup() {
  const client = useConvexAuthClient();
  return (
    <button
      onClick={async () => {
        const setup = await client.totp?.setup();
        // show QR code, etc.
      }}
    >
      Enable TOTP
    </button>
  );
}
```

`client.totp`, `client.passkey`, `client.device` are present only when the
underlying providers are configured server-side.

## SSR

`useAuth()` returns a fixed loading snapshot during SSR, so it never throws
on first render. The actual auth state hydrates on the client after
`ConvexAuthProvider` mounts. For framework-specific token-prefetch helpers,
see [SSR overview](/ssr/overview).
