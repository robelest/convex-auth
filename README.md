# Convex Auth (Component-First)

Convex Auth is authentication for Convex, built around a reusable component boundary.
This repo contains the auth package, examples, and a shared auth test suite.

For full generated docs, see: https://deepwiki.com/robelest/convex-auth

## Quick Start

### 1) Install dependencies

```bash
bun install
```

### 2) Start Convex

```bash
bun run dev:convex
```

### 3) Run auth tests

```bash
bun run test:auth
```

## Minimal Setup

### 1) Register components in your app config

`convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import auth from "@convex-dev/auth/convex.config";

const app = defineApp();

app.use(auth);

export default app;
```

### 2) Configure auth with the component reference

`convex/auth.ts`

```ts
import { Auth } from "@convex-dev/auth/component";
import password from "@convex-dev/auth/providers/Password";
import { components } from "./_generated/api";

export const { auth, signIn, signOut, store } = Auth({
  component: components.auth,
  providers: [password],
});
```

### 3) Add auth HTTP routes

`convex/http.ts`

```ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

export default http;
```

## Backend Usage

Use `auth.user.*` helpers in Convex functions:

```ts
import { query } from "./_generated/server";
import { auth } from "./auth";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    return await auth.user.get(ctx, userId);
  },
});
```

Common helpers:

- `auth.user.current(ctx)` returns the signed-in user id or `null`.
- `auth.user.require(ctx)` returns user id or throws if not signed in.
- `auth.user.get(ctx, userId)` fetches a user by id via the auth component.
- `auth.user.viewer(ctx)` fetches the current signed-in user document.

## Component System

The auth runtime uses `component: components.auth` to execute storage and auth operations through a component API boundary.
This gives you a clean integration point and keeps auth primitives (users, accounts, sessions, verification, rate limits, and org/member/invite APIs) in one place.

## Useful Paths In This Repo

- `convex/auth.ts`
- `convex/http.ts`
- `convex/convex.config.ts`
- `packages/auth/src/component/public.ts`
- `packages/test/convex/auth-suite.test.ts`
