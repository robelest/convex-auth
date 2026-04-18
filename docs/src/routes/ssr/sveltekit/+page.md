---
title: SvelteKit
description: Integrate convex-auth SSR with SvelteKit using hooks and API routes.
---

<svelte:head>

  <title>SvelteKit - convex-auth</title>
</svelte:head>

# SvelteKit

SvelteKit integration uses two files: a server hook for token refresh on every
request, and an API route to proxy client-side sign-in/sign-out calls.

## Server hook

In `src/hooks.server.ts`, call `auth.refresh()` on every request. Apply the
returned cookies and pass the token to page data via `event.locals`.

```ts
// src/hooks.server.ts
import { server } from "@robelest/convex-auth/server";
import type { Handle } from "@sveltejs/kit";

const auth = server({ url: import.meta.env.CONVEX_URL });

export const handle: Handle = async ({ event, resolve }) => {
  const result = await auth.refresh(event.request);

  if (result.redirect) {
    return result.response;
  }

  const { cookies, token } = result;

  // Apply auth cookies to the response
  for (const cookie of cookies) {
    event.cookies.set(cookie.name, cookie.value, {
      path: cookie.path ?? "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "lax" | "strict" | "none",
      maxAge: cookie.maxAge,
    });
  }

  // Make the token available to load functions
  event.locals.token = token;

  return resolve(event);
};
```

## Auth proxy route

Create `src/routes/api/auth/+server.ts` to handle client-side sign-in and
sign-out POST requests:

```ts
// src/routes/api/auth/+server.ts
import { server } from "@robelest/convex-auth/server";
import type { RequestHandler } from "./$types";

const auth = server({ url: import.meta.env.CONVEX_URL });

export const POST: RequestHandler = async ({ request }) => {
  return auth.proxy(request);
};
```

Point your client-side auth configuration to `/api/auth` so that sign-in and
sign-out calls are routed through this endpoint.

## Client setup

In your root layout, create the auth client with `proxyPath` and `location`:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { page } from "$app/state";
  import { setupConvex, useConvexClient } from "convex-svelte";
  import { setContext } from "svelte";
  import { client as createAuthClient } from "@robelest/convex-auth/browser";

  let { data, children } = $props();

  setupConvex(data.convexUrl);
  const convexClient = useConvexClient();

  const auth = createAuthClient({
    convex: convexClient,
    proxyPath: "/api/auth",
    tokenSeed: data.auth.token ?? null,
    location: () => page.url, // SSR-safe URL reading
  });

  setContext("auth", auth);
</script>
```

Use `auth.param()` for SSR-safe URL parameter reading and `auth.invite` for
invite token handling. See [SSR Overview](/ssr/overview/) for the full client
API.

## Accessing the token

After the hook runs, you can access `event.locals.token` in any server load
function to pass the token to the client or to call Convex functions
server-side:

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return { token: locals.token };
};
```
