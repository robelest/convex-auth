---
title: SSR Overview
description:
  Server-side authentication with httpOnly cookies, OAuth code exchange, and
  token refresh.
---

<svelte:head>

  <title>SSR Overview - convex-auth</title>
</svelte:head>

# SSR Overview

The `server()` helper from `@robelest/convex-auth/server` gives your SSR
framework a single entry point for OAuth code exchange, token refresh, and
httpOnly cookie management. It works with any framework that gives you access to
the incoming `Request` object.

## Basic usage

```ts
import { server } from "@robelest/convex-auth/server";

const auth = server({ url: process.env.CONVEX_URL! });

// In your server handler / middleware:
const { cookies, redirect, token } = await auth.refresh(request);
```

`auth.refresh(request)` reads the auth cookies from the incoming request,
exchanges or refreshes tokens with your Convex backend, and returns everything
you need to continue the response.

## Return fields

| Field      | Type             | Description                                                                                |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `cookies`  | `AuthCookie[]`   | Array of `Set-Cookie` values to apply to the response. Always set these, even on redirect. |
| `redirect` | `string \| null` | If non-null, the user should be redirected to this URL (e.g. after OAuth code exchange).   |
| `token`    | `string \| null` | The current JWT access token, or `null` if the user is not authenticated.                  |

Each `AuthCookie` object contains `name`, `value`, and standard cookie options
(`httpOnly`, `secure`, `sameSite`, `path`, `maxAge`). How you apply them depends
on your framework — see the framework-specific guides.

## Proxying client requests

For client-side sign-in and sign-out flows, use `auth.proxy()` to forward POST
requests to your Convex backend:

```ts
const response = await auth.proxy(request);
```

`proxy()` handles:

- **Sign-in** — forwards credentials to Convex, returns `Set-Cookie` headers
  with the new session tokens.
- **Sign-out** — clears the session on the backend and returns cookie-clearing
  headers.

Mount this behind a `/api/auth` route (or similar) and point your client-side
auth calls to that endpoint.

## Options

### `acceptedIssuers`

By default, `server()` only accepts tokens issued by your Convex deployment. If
you need to accept tokens from additional issuers (e.g. a custom OIDC provider),
pass them in the `acceptedIssuers` array:

```ts
const auth = server({
  url: process.env.CONVEX_URL!,
  acceptedIssuers: ["https://auth.example.com"],
});
```

## Client-side auth

The `client()` function from `@robelest/convex-auth/client` creates the
client-side auth state manager. It works with any Convex client transport.

```ts
import { client as createAuthClient } from "@robelest/convex-auth/client";

const auth = createAuthClient({
  convex: convexClient,
  proxyPath: "/api/auth",
  tokenSeed: serverToken,
  location: () => currentUrl, // SSR-safe URL source
});
```

### `location` option

Pass a URL source so the client can safely read query parameters during SSR
(where `window` is not available). Each framework provides this differently:

- **SvelteKit:** `location: () => page.url` (from `$app/state`)
- **Next.js:** pass from server props or `useSearchParams()`
- **TanStack Start:** pass from `useServerFn()` or loader data
- **SPA:** omit (defaults to `window.location` with SSR guard)

### `auth.param(name)`

SSR-safe URL parameter reader. Uses the `location` option, falls back to
`window.location` when available:

```ts
const workspaceId = auth.param("workspace");
```

### `auth.invite`

The client automatically detects invite tokens from `?invite=` URL parameters
and persists them across OAuth redirects. After authentication, the app can
consume the invite:

```ts
if (auth.invite) {
  const { token } = await auth.invite.accept();
  // Use the token to call your accept mutation
  await client.mutation(api.acceptInvite, { token });
}
```

The client handles:

- Reading `?invite=` and `?email=` from the URL
- Persisting the token to storage before `signIn()` (survives OAuth redirects)
- Recovering the token from storage after redirect
- Cleaning up URL parameters after `accept()`

## Next steps

See the framework-specific guides for full integration examples:

- [SvelteKit](/ssr/sveltekit/)
- [TanStack Start](/ssr/tanstack/)
- [Next.js](/ssr/nextjs/)
