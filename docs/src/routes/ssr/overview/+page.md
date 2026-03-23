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

## Next steps

See the framework-specific guides for full integration examples:

- [SvelteKit](/ssr/sveltekit/)
- [TanStack Start](/ssr/tanstack/)
- [Next.js](/ssr/nextjs/)
