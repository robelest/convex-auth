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

Eliminate per-handler auth boilerplate with `auth.ctx()`. Set up once, and every
query/mutation gets `ctx.auth.userId`, `ctx.auth.groupId`, `ctx.auth.role`, and
`ctx.auth.grants` automatically.

Requires [`convex-helpers`](https://github.com/get-convex/convex-helpers).

This is optional app code layered on top of the minimal auth setup. You do not
need it for normal `convex-auth` installation.

## Setup

Import from `@robelest/convex-auth/core` for your query and mutation wrappers.
This keeps provider, OAuth, and crypto code out of your query bundles entirely.

```ts
// convex/auth/core.ts
import { createAuthContext } from "@robelest/convex-auth/core";
import { components } from "../_generated/api";

export const auth = createAuthContext(components.auth);
```

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
import { auth } from "../auth/core";

const authCtx = auth.ctx();

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

The canonical `convex-auth` integration uses:

- `convex/convex.config.ts` — component registration
- `convex/auth.ts` — provider config, exports `signIn`/`signOut`/`store`
- `convex/auth/core.ts` — lightweight context for queries/mutations
- `convex/http.ts` — OAuth callbacks and JWKS routes

## When to use `core` vs `auth`

Use `convex/auth/core.ts` anywhere you only need auth context or helper
lookups inside Convex functions.

- Queries and mutations wrapped with `auth.ctx()`
- Permission checks like `auth.member.require(ctx, ...)`
- Helper lookups like `auth.user.get`, `auth.member.list`, `auth.group.get`
- Account and key management like `auth.account.listPasskeys` and `auth.key.list`

Use `convex/auth.ts` only for the full runtime surface.

- Exporting `signIn`, `signOut`, and `store`
- Registering HTTP routes with `auth.http.add(http)`
- Calling `auth.http.context(ctx, request)`
- Passing the full auth runtime into higher-level server helpers such as group SSO setup

[In this repo](https://github.com/robelest/convex-auth/tree/main/convex), `convex/comments.ts`, `convex/projects.ts`, `convex/issues.ts`,
`convex/groups.ts`, and `convex/account.ts` all use `core` because they only
need `ctx.auth` and helper APIs. `convex/http.ts` stays on `auth.ts` because it
needs the HTTP runtime methods.

## Optional auth (public routes)

```ts
export const publicQuery = customQuery(rawQuery, auth.ctx({ optional: true }));
// ctx.auth.userId is null and ctx.auth.grants is [] when unauthenticated
```

## Add app-specific fields

```ts
const authCtx = auth.ctx({
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

You can test `auth.ctx()`-based functions with
[`convex-test`](https://docs.convex.dev/testing) without hitting component
tables.

### Why this needs a hook

`auth.ctx()` captures the `auth` object at module load time and resolves auth
from the component's `User`, `Member`, and group state tables. In `convex-test`,
those component tables are empty, so resolution always returns an
unauthenticated state even if you mock the auth module import.

Use `authResolve` to inject pre-resolved auth state or fall back to the built-in
resolver.

### Register the component

Make sure your `convex-test` harness mounts the Convex Auth component before
invoking wrappers that call `auth.ctx()` or `auth.context(...)`.

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
import type { AuthContext } from "@robelest/convex-auth/component";
import { auth } from "../auth";

let _authResolve: ((ctx: any) => AuthContext | null | undefined) | undefined;

export function setTestAuth(fn: typeof _authResolve) {
  _authResolve = fn;
}

const authCtx = auth.ctx({
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
const authCtx = auth.ctx({
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
