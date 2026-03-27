---
title: Context Enrichment
description:
  Zero-boilerplate ctx.auth.userId, groupId, role, and grants via
  convex-helpers.
---

<svelte:head>

  <title>Context Enrichment - convex-auth</title>
</svelte:head>

# Context Enrichment

Eliminate per-handler auth boilerplate with `AuthCtx`. Set up once, and every
query/mutation gets `ctx.auth.userId`, `ctx.auth.groupId`, `ctx.auth.role`, and
`ctx.auth.grants` automatically.

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
    // ctx.auth.userId — authenticated user ID
    // ctx.auth.user   — full user document
    // ctx.auth.grants — resolved grant strings for the active group
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
// ctx.auth.userId is null and ctx.auth.grants is [] when unauthenticated
```

## Add app-specific fields

```ts
const authCtx = AuthCtx(auth, {
  resolve: async (_ctx, user, authState) => {
    return {
      activeGroupId: authState.groupId ?? user?.extend?.lastActiveGroup ?? null,
      canManageMembers: authState.grants.includes("members.create"),
    };
  },
});
// ctx.auth.groupId, ctx.auth.role, ctx.auth.grants,
// and ctx.auth.canManageMembers available in all handlers
```

## What's on `ctx.auth`

| Property            | Type                            | Description                      |
| ------------------- | ------------------------------- | -------------------------------- |
| `userId`            | `string`                        | Authenticated user's document ID |
| `user`              | `object \| null`                | Full user document               |
| `groupId`           | `string \| null`                | Active group ID                  |
| `role`              | `string \| null`                | Primary role for active group    |
| `grants`            | `string[]`                      | Resolved grants for active group |
| `getUserIdentity()` | `Promise<UserIdentity \| null>` | Native Convex method (preserved) |
| `...extra`          | varies                          | Whatever `resolve()` returns     |

## Testing with `convex-test`

You can test `AuthCtx`-based functions with
[`convex-test`](https://docs.convex.dev/testing) without hitting component
tables.

### Why this needs a hook

`AuthCtx` captures the `auth` object at module load time and resolves auth from
the component's `User`, `Member`, and group state tables. In `convex-test`,
those component tables are empty, so resolution always returns an
unauthenticated state even if you mock the auth module import.

Use `authResolve` to inject pre-resolved auth state or fall back to the built-in
resolver.

### Register the component

```ts
// convex/test.setup.ts
import { convexTest } from "convex-test";
import { register } from "@robelest/convex-auth/test";
import schema from "./schema";

export function setupTest() {
  const t = convexTest(schema);
  register(t);
  return t;
}
```

### Add a test-aware wrapper

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
import type { AuthContext } from "@robelest/convex-auth/component";
import { auth } from "../auth";

let _authResolve: ((ctx: any) => AuthContext | null | undefined) | undefined;

export function setTestAuth(fn: typeof _authResolve) {
  _authResolve = fn;
}

const authCtx = AuthCtx(auth, {
  authResolve: async (ctx, fallback) => {
    const resolved = await _authResolve?.(ctx);
    return resolved === undefined ? fallback() : resolved;
  },
});

export const query = customQuery(rawQuery, authCtx);
export const mutation = customMutation(rawMutation, authCtx);
```

Then in tests:

```ts
// convex/chat.test.ts
import { expect, test, beforeEach, afterEach } from "vitest";
import { setupTest } from "./test.setup";
import { setTestAuth } from "./lib/functions";
import { api } from "./_generated/api";

beforeEach(() => {
  setTestAuth(() => ({
    userId: "user123" as any,
    user: { _id: "user123", email: "alice@example.com" },
    groupId: null,
    role: null,
    grants: [],
  }));
});

afterEach(() => {
  setTestAuth(undefined);
});

test("list messages for authenticated user", async () => {
  const t = setupTest();
  const result = await t.query(api.chat.list, {});
  expect(result).toBeDefined();
});
```

### Reusable test helper

```ts
// convex/test.helpers.ts
import type { AuthContext } from "@robelest/convex-auth/component";

interface TestAuthState {
  userId: string;
  email?: string;
  groupId?: string | null;
  role?: string | null;
  grants?: string[];
}

export function createTestAuth(state: TestAuthState): () => AuthContext {
  return () => ({
    userId: state.userId as any,
    user: {
      _id: state.userId,
      email: state.email ?? "test@example.com",
    } as any,
    groupId: state.groupId ?? null,
    role: state.role ?? null,
    grants: state.grants ?? [],
  });
}
```

```ts
// In tests
import { createTestAuth } from "./test.helpers";
import { setTestAuth } from "./lib/functions";

setTestAuth(createTestAuth({ userId: "user1" }));

setTestAuth(
  createTestAuth({
    userId: "user1",
    groupId: "org1",
    role: "orgAdmin",
    grants: ["members.create", "members.delete"],
  }),
);

setTestAuth(() => null);
```

### Works with `resolve`

`authResolve` can replace the internal auth lookup, and `resolve` still runs on
top:

```ts
const authCtx = AuthCtx(auth, {
  authResolve: async (ctx, fallback) => {
    const resolved = await _authResolve?.(ctx);
    return resolved === undefined ? fallback() : resolved;
  },
  resolve: async (_ctx, _user, auth) => {
    return { activeGroupId: auth.groupId };
  },
});
```

### Unauthenticated test state

For `optional: true` routes, return `null` from `authResolve`:

```ts
setTestAuth(() => null);

test("public route works without auth", async () => {
  const t = setupTest();
  const result = await t.query(api.public.homepage, {});
  // ctx.auth.userId/user/groupId/role are null and ctx.auth.grants is []
  expect(result).toBeDefined();
});
```
