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
Each membership stores assigned `roleIds`, and `auth.member.resolve(...)`
combines membership lookup, role filtering, inheritance, and grant checks.

See [Authorization Patterns](/guides/authorization) for the full model.

## Methods

| Method    | Signature                                                               | Returns               | Description                                                                                                           |
| --------- | ----------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `create`  | `(ctx, { userId, groupId, roleIds? })`                                  | `{ ok, memberId }`    | Creates a user membership in a group with optional assigned role IDs.                                                 |
| `get`     | `(ctx, memberId)`                                                       | `Doc<"members"> \| null` | Returns the membership record for a given membership ID, or `null` if it does not exist.                             |
| `list`    | `(ctx, { groupId?, userId?, limit?, cursor? })`                         | Paginated member list | Lists members by group, by user, or both.                                                                             |
| `update`  | `(ctx, memberId, { roleIds?, status?, extend? })`                       | `{ ok, memberId }`    | Updates a membership's assigned role IDs or metadata.                                                                 |
| `delete`  | `(ctx, memberId)`                                                       | `{ ok, memberId }`    | Deletes a user membership from a group.                                                                               |
| `resolve` | `(ctx, { userId, groupId, ancestry?, roleIds?, grants?, maxDepth? })` | Resolution result     | Resolves membership, optional inheritance, role filters, and grant checks in one call.                               |

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

### Check grants with `resolve`

```ts
const result = await auth.member.resolve(ctx, {
  userId,
  groupId: orgId,
  grants: ["members.update"],
});

if (!result.ok) {
  throw new Error(`Missing grants: ${result.missingGrants.join(", ")}`);
}
```

### Resolve role from parent group

```ts
// Checks teamId, then walks up to the parent org
const match = await auth.member.resolve(ctx, {
  userId,
  groupId: teamId,
});

if (match.membership) {
  console.log(match.roleIds, match.matchedGroupId, match.grants);
}
```

### Resolve with ancestry trail

Pass `ancestry: true` to get the list of group IDs traversed during resolution:

```ts
const match = await auth.member.resolve(ctx, {
  userId,
  groupId: teamId,
  ancestry: true,
});

// match.traversedGroupIds: [teamId, parentOrgId, ...]
```
