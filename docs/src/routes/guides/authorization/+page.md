---
title: Authorization Patterns
description: Identity, profile, and access control patterns.
---

<svelte:head>

  <title>Authorization Patterns - convex-auth</title>
</svelte:head>

# Authorization Patterns

## Use `userId` for authorization

- Use `userId` for authorization checks (stable identity)
- Use email only for lookup/bootstrap UX (human input)
- Persist admin grants by `userId` in your app table

## Why email is not on `getUserIdentity()`

`ctx.auth.getUserIdentity()` returns Convex identity claims from the JWT. The
token subject is `userId|sessionId`, and email is stored on the user document.

This is intentional:

- Email can change
- Some providers don't guarantee email
- Sessions should remain valid even if profile fields change

Read identity from `auth.user.*`, then read profile fields from the user
document.

## Access check pattern

```ts
import { query } from "./_generated/server";
import { auth } from "./auth";

export const canAccessAdminTools = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    const grant = await ctx.db
      .query("accessGrants")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return grant !== null;
  },
});
```

## Account/User relationship

Accounts are many-to-one with users:

- One `User` can have many linked `Account` records (GitHub + Google + password)
- Each `Account` belongs to exactly one `User`

This is why authorization should be keyed on `userId`, not provider account IDs.

## Common patterns

- **Need current user ID?** `await auth.user.require(ctx)`
- **Need current user email/profile?** `await auth.user.viewer(ctx)`
- **Public route with optional auth?** `await auth.user.current(ctx)` and branch
  on `null`
