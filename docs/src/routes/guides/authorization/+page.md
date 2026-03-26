---
title: Authorization Patterns
description: Identity, profile, and access control patterns.
---

<svelte:head>

  <title>Authorization Patterns - convex-auth</title>
</svelte:head>

# Authorization Patterns

Convex Auth's authorization model is:

- app-defined roles in `createAuth({ authorization: { roles } })`
- per-group membership assignment via `roleIds`
- grant-based enforcement via `auth.member.resolve(...)`

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

Role names are completely app-defined. What matters is the grants attached to
them.

## Assign roles with memberships

Memberships store `roleIds`.

```ts
await auth.member.create(ctx, {
  userId,
  groupId: orgId,
  roleIds: [roles.orgAdmin.id],
});
```

Update them the same way:

```ts
await auth.member.update(ctx, memberId, {
  roleIds: [roles.support.id],
});
```

Invites can also pre-assign role ids:

```ts
await auth.invite.create(ctx, {
  groupId: orgId,
  email: "alice@example.com",
  roleIds: [roles.member.id],
});
```

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

## Authorization pattern

```ts
import { query } from "./_generated/server";
import { auth } from "./auth";

export const canAccessAdminTools = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.id(ctx);
    if (userId === null) {
      return false;
    }
    const result = await auth.member.resolve(ctx, {
      userId,
      groupId: "group_id_here",
      grants: ["admin.tools.read"],
    });
    return result.ok;
  },
});
```

Prefer checking grants instead of checking role names directly.

```ts
const result = await auth.member.resolve(ctx, {
  userId,
  groupId: orgId,
  grants: ["sso.connection.manage"],
});
if (!result.ok) {
  throw new Error("Forbidden");
}
```

## Membership traversal

If your groups are nested, `auth.member.resolve(...)` can still resolve
inherited membership, but access decisions should usually be expressed in
grants.

```ts
const resolution = await auth.member.resolve(ctx, {
  userId,
  groupId: teamId,
  grants: ["members.read"],
});
```

## Performance: derive permissions from resolved grants

When you already have a user's resolved grants (e.g. from `member.resolve`), you
can derive permissions locally instead of making separate authorization calls:

```ts
const workspace = await auth.member.resolve(ctx, { userId, groupId });
const { grants } = workspace;

// Derive permissions from already-resolved grants (no extra DB reads)
const permissions = {
  canCreate: grants.includes("items.create"),
  canEdit: grants.includes("items.edit"),
  canDelete: grants.includes("items.delete"),
};
```

This avoids redundant round trips when you need to check multiple grants for the
same user and group.

## Enterprise mounted RPC

When mounting enterprise RPC, keep the authorization callback and initial admin
role assignment together:

```ts
export const enterpriseApi = enterprise(auth, {
  admin: {
    authorized,
    roles: [roles.orgAdmin],
  },
});
```

- `admin.authorized` decides whether the caller may perform the requested admin
  operation.
- `admin.roles` are assigned to the creator when `createConnection` auto-creates
  a new enterprise group.

## Account/User relationship

Accounts are many-to-one with users:

- One `User` can have many linked `Account` records (GitHub + Google + password)
- Each `Account` belongs to exactly one `User`

This is why authorization should be keyed on `userId`, not provider account IDs.

## Common patterns

- **Need current user ID?** `await auth.user.id(ctx)` (returns `string | null`)
- **Need current user email/profile?** `await auth.user.viewer(ctx)`
- **Public route with optional auth?** `await auth.user.id(ctx)` and branch on
  `null`

## Recommended pattern

- define roles globally in config
- assign `roleIds` per membership
- check grants in server functions
- treat role ids as labels and grants as the actual authorization contract

See also:

- [`auth.member`](/api/member)
- [Enterprise RPC](/sso/rpc)
