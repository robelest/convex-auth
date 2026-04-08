---
title: Authorization Patterns
description: Identity, profile, and access control patterns.
---

<svelte:head>

  <title>Authorization Patterns - convex-auth</title>
</svelte:head>

# Authorization Patterns

Convex Auth keeps authorization simple. You define roles in
`createAuth({ authorization: { roles } })`, assign those role ids to group
memberships, and enforce access by checking grants with
`auth.member.require(...)` or `auth.member.inspect(...)`.

## Define roles

Use `defineRoles(...)` so your role ids and grants stay typed everywhere else in
your app.

```ts
import { defineRoles } from "@robelest/convex-auth/authorization";
import { createAuth } from "@robelest/convex-auth/component";

export const roles = defineRoles({
  orgAdmin: {
    label: "Organization Admin",
    grants: [
      "members.create",
      "members.update",
      "members.delete",
      "sso.connection.manage",
      "scim.manage",
    ],
  },
  support: {
    label: "Support",
    grants: ["members.read", "tickets.manage"],
  },
  member: {
    label: "Member",
    grants: [],
  },
});

export const auth = createAuth(components.auth, {
  providers: [
    /* ... */
  ],
  authorization: {
    roles,
  },
});
```

Role names are labels for humans. Grants are what your code should trust.

## Assign roles with memberships

Memberships store `roleIds`. That keeps authorization attached to a user's
relationship with a group instead of scattering permission state across your own
tables.

```ts
await auth.member.create(ctx, {
  userId,
  groupId: orgId,
  roleIds: [roles.orgAdmin.id],
});
```

You update memberships the same way:

```ts
await auth.member.update(ctx, memberId, {
  roleIds: [roles.support.id],
});
```

Invites can pre-assign role ids before the user joins:

```ts
await auth.invite.create(ctx, {
  groupId: orgId,
  email: "alice@example.com",
  roleIds: [roles.member.id],
});
```

## Use `userId` for authorization

Key authorization to `userId`, not email and not provider account ids. `userId`
is the stable identity in your app. Email is useful for lookup and onboarding,
but people change email addresses and some providers do not guarantee one.

If your app persists admin or support access outside memberships, store that
state by `userId`.

## Why email is not on `getUserIdentity()`

`ctx.auth.getUserIdentity()` returns Convex identity claims from the JWT. The
token subject is `userId|sessionId`, and email is stored on the user document.

This is intentional. Email can change, some providers do not guarantee one, and
sessions should stay valid even if profile fields change.

In app code, resolve authentication once with `auth.ctx()` and then use
`ctx.auth.userId` / `ctx.auth.user` in handlers.

## Authorization pattern

These examples assume your handlers use auth-aware builders that inject
`ctx.auth` once in `convex/functions.ts`:

```ts
import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { auth } from "./auth";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

```ts
import { authQuery } from "./functions";
import { auth } from "./auth";

export const canAccessAdminTools = authQuery({
  args: {},
  handler: async (ctx) => {
    const result = await auth.member.inspect(ctx, {
      userId: ctx.auth.userId,
      groupId: "group_id_here",
    });
    return result.grants.includes("admin.tools.read");
  },
});
```

Check grants instead of role names. A role name is a label. The grants attached
to it are the real contract.

```ts
// Use this when the handler should fail instead of returning a boolean.
await auth.member.require(ctx, {
  userId: ctx.auth.userId,
  groupId: orgId,
  grants: ["sso.connection.manage"],
});
```

## Membership traversal

If your groups are nested, `auth.member.inspect(...)` can still resolve
inherited membership, but access decisions should usually be expressed in
grants.

```ts
const result = await auth.member.inspect(ctx, {
  userId: ctx.auth.userId,
  groupId: teamId,
});

if (result.grants.includes("members.read")) {
  // authorized
}
```

## Performance: derive permissions from resolved grants

When you already have a user's resolved grants (e.g. from `member.inspect`), you
can derive permissions locally instead of making separate authorization calls:

```ts
const { grants } = await auth.member.inspect(ctx, {
  userId: ctx.auth.userId,
  groupId,
});

// Derive permissions from already-resolved grants (no extra DB reads)
const permissions = {
  canCreate: grants.includes("items.create"),
  canEdit: grants.includes("items.edit"),
  canDelete: grants.includes("items.delete"),
};
```

This avoids redundant round trips when you need to check multiple grants for the
same user and group.

## Group Connection mounted RPC

When you mount group SSO RPC, keep the authorization callback and the initial
admin role assignment in the same block:

```ts
export const groupApi = group(auth, {
  admin: {
    authorized,
    roles: [roles.orgAdmin],
  },
});
```

`admin.authorized` decides whether the caller may perform the requested admin
operation. `admin.roles` are assigned to the creator when `createConnection`
auto-creates a new group.

## Account/User relationship

Accounts are many-to-one with users. One `User` can have many linked `Account`
records, such as GitHub, Google, and password. Each `Account` still belongs to
exactly one `User`.

This is why authorization should be keyed on `userId`, not provider account IDs.

## Common patterns

Use `auth.ctx()` when a handler should always receive `ctx.auth.userId` and
`ctx.auth.user`. Use `auth.member.inspect(...)` when you need a boolean-style
access check. Use `auth.member.require(...)` when the handler should throw on
failure. Use `auth.ctx({ optional: true })` when the same handler should work
for both guests and signed-in users.

## Recommended pattern

Define roles once in config. Assign `roleIds` per membership. Check grants in
server functions. Treat role ids as labels and grants as the actual
authorization contract.

See [`auth.member`](/api/member) for the API surface and
[Group SSO RPC](/sso/rpc) for the mounted admin flow.
