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
Each membership stores assigned `roleIds`. Use `auth.member.inspect(...)` to
look up membership details and `auth.member.require(...)` to enforce
authorization with a single call.

See [Authorization Patterns](/guides/authorization) for the full model.

## Methods

| Method    | Signature                                                             | Returns                           | Description                                                                                                                         |
| --------- | --------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | `(ctx, { userId, groupId, roleIds? })`                                | `{ memberId }`                    | Creates a user membership in a group with optional assigned role IDs. Throws `ConvexError` with code `INVALID_ROLE_IDS` on failure. |
| `get`     | `(ctx, memberId)`                                                     | `Doc<"members"> \| null`          | Returns the membership record for a given membership ID, or `null` if it does not exist.                                            |
| `list`    | `(ctx, { groupId?, userId?, limit?, cursor? })`                       | Paginated member list             | Lists members by group, by user, or both.                                                                                           |
| `update`  | `(ctx, memberId, { roleIds?, status?, extend? })`                     | `{ memberId }`                    | Updates a membership's assigned role IDs or metadata. Throws `ConvexError` with code `INVALID_ROLE_IDS` on failure.                 |
| `delete`  | `(ctx, memberId)`                                                     | `{ memberId }`                    | Deletes a user membership from a group.                                                                                             |
| `inspect` | `(ctx, { userId, groupId, ancestry?, maxDepth? })`                    | `{ membership, roleIds, grants }` | Looks up membership, resolves roles and grants. Returns result without throwing.                                                    |
| `require` | `(ctx, { userId, groupId, ancestry?, roleIds?, grants?, maxDepth? })` | `{ membership, roleIds, grants }` | Resolves membership and enforces required roleIds/grants. Throws `ConvexError` on failure.                                          |

## Examples

### Create a membership

```ts
const { memberId } = await auth.member.create(ctx, {
  userId,
  groupId: orgId,
  roleIds: ["member"],
});
```

### Check membership by record ID

```ts
const member = await auth.member.get(ctx, memberId);

if (!member) {
  throw new Error("Membership not found");
}
```

### Inspect membership and grants

```ts
const result = await auth.member.inspect(ctx, {
  userId,
  groupId: orgId,
});

if (result.membership) {
  console.log(result.roleIds); // e.g. ["orgAdmin"]
  console.log(result.grants); // e.g. ["members.create", "members.update"]
}
```

### Require specific grants (throws on failure)

```ts
// Throws `NOT_A_MEMBER` or `MISSING_GRANTS` on failure.
await auth.member.require(ctx, {
  userId,
  groupId: orgId,
  grants: ["members.update"],
});
```

### Inspect role from parent group

```ts
// Checks teamId, then walks up to the parent org
const result = await auth.member.inspect(ctx, {
  userId,
  groupId: teamId,
});

if (result.membership) {
  console.log(result.roleIds, result.grants);
}
```

### Inspect with ancestry trail

Pass `ancestry: true` to get the list of group IDs traversed during resolution:

```ts
const result = await auth.member.inspect(ctx, {
  userId,
  groupId: teamId,
  ancestry: true,
});
```
