---
title: auth.member
description:
  Membership management — add users to groups with roles and permissions.
---

<svelte:head>

  <title>auth.member - convex-auth</title>
</svelte:head>

# auth.member

The `auth.member` namespace manages the relationship between users and groups.
Each membership has a `role` field that you can use for authorization.

## Methods

| Method              | Signature                                       | Returns                  | Description                                                                                             |
| ------------------- | ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `add`               | `(ctx, { userId, groupId, role })`              | `Id<"members">`          | Adds a user to a group with a given role.                                                               |
| `getByUserAndGroup` | `(ctx, { userId, groupId })`                    | `Doc<"members"> \| null` | Returns the membership record for a user in a group, or `null` if they are not a member.                |
| `list`              | `(ctx, { groupId?, userId?, limit?, cursor? })` | Paginated member list    | Lists members by group, by user, or both.                                                               |
| `update`            | `(ctx, memberId, { role })`                     | `void`                   | Updates a member's role.                                                                                |
| `remove`            | `(ctx, memberId)`                               | `void`                   | Removes a user from a group.                                                                            |
| `inherit`           | `(ctx, { userId, groupId })`                    | `string \| null`         | Walks up the group hierarchy and returns the first role found for the user, or `null`.                  |
| `require`           | `(ctx, { userId, groupId, role? })`             | `Doc<"members">`         | Returns the membership or **throws `FORBIDDEN`** if the user is not a member (or lacks the given role). |

> **Note:** `require` throws a `FORBIDDEN` error if the user is not a member of
> the specified group. If a `role` is provided, it also checks that the member
> has that exact role.

## Examples

### Add a member

```ts
await auth.member.add(ctx, {
  userId,
  groupId: orgId,
  role: "member",
});
```

### Check membership

```ts
const member = await auth.member.getByUserAndGroup(ctx, {
  userId,
  groupId: orgId,
});

if (!member) {
  throw new Error("Not a member of this organization");
}
```

### Require admin role

```ts
// Throws FORBIDDEN if not an admin
await auth.member.require(ctx, {
  userId,
  groupId: orgId,
  role: "admin",
});
```

### Inherit role from parent group

```ts
// Checks teamId, then walks up to the parent org
const role = await auth.member.inherit(ctx, {
  userId,
  groupId: teamId,
});
```
