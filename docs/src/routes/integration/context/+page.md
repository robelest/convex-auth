---
title: Context Enrichment
description:
  Zero-boilerplate ctx.auth.userId and ctx.auth.user via convex-helpers.
---

<svelte:head>

  <title>Context Enrichment - convex-auth</title>
</svelte:head>

# Context Enrichment

Eliminate per-handler auth boilerplate with `AuthCtx`. Set up once, and every
query/mutation gets `ctx.auth.userId` and `ctx.auth.user` automatically.

Requires [`convex-helpers`](https://github.com/get-convex/convex-helpers).

This is optional app code layered on top of the minimal auth setup. You do not
need it for normal `convex-auth` installation.

## Setup

```ts
// convex/lib/functions.ts
import {
  customQuery,
  customMutation,
} from "convex-helpers/server/customFunctions";
import {
  query as rawQuery,
  mutation as rawMutation,
} from "../_generated/server";
import { AuthCtx } from "@robelest/convex-auth/component";
import { auth } from "../auth";

const authCtx = AuthCtx(auth);

export const query = customQuery(rawQuery, authCtx);
export const mutation = customMutation(rawMutation, authCtx);
```

## Usage

```ts
// convex/chat.ts
import { query, mutation } from "./lib/functions";

export const list = query({
  args: {},
  handler: async (ctx) => {
    // ctx.auth.userId — authenticated user ID (throws if not signed in)
    // ctx.auth.user   — full user document
    return ctx.db.query("messages").collect();
  },
});
```

The canonical `convex-auth` integration still only needs:

- `convex/convex.config.ts`
- `convex/auth.ts`
- `convex/http.ts`

## Optional auth (public routes)

```ts
export const publicQuery = customQuery(
  rawQuery,
  AuthCtx(auth, { optional: true }),
);
// ctx.auth.userId is null when unauthenticated, no error thrown
```

## Multi-tenant with group resolution

```ts
const authCtx = AuthCtx(auth, {
  resolve: async (ctx, user) => {
    const groupId = user?.extend?.lastActiveGroup;
    const membership = await auth.member.getByUserAndGroup(ctx, {
      userId: user._id,
      groupId,
    });
    return { groupId, role: membership?.role ?? "member" };
  },
});
// ctx.auth.groupId and ctx.auth.role available in all handlers
```

## What's on `ctx.auth`

| Property            | Type                            | Description                      |
| ------------------- | ------------------------------- | -------------------------------- |
| `userId`            | `string`                        | Authenticated user's document ID |
| `user`              | `object \| null`                | Full user document               |
| `getUserIdentity()` | `Promise<UserIdentity \| null>` | Native Convex method (preserved) |
| `...extra`          | varies                          | Whatever `resolve()` returns     |
