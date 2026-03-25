---
title: auth.access
description:
  Grant-based authorization checks resolved from app-defined role IDs.
---

<svelte:head>

  <title>auth.access - convex-auth</title>
</svelte:head>

# auth.access

The `auth.access` namespace evaluates grant-based authorization for a user in a
group. Role definitions live in `createAuth({ authorization: { roles } })`, and
memberships assign `roleIds` per group.

For the full model, see [Authorization Patterns](/guides/authorization).

## Methods

| Method  | Signature                                       | Returns                                                                                            | Description                                                        |
| ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `check` | `(ctx, { userId, groupId, grants, maxDepth? })` | `{ ok, membership, matchedGroupId, roleIds, grants, missingGrants, isDirect, isInherited, depth }` | Checks whether a user has all requested grants in the group scope. |

## Example

```ts
const result = await auth.access.check(ctx, {
  userId,
  groupId: orgId,
  grants: ["members.update"],
});

if (!result.ok) {
  throw new Error(`Missing grants: ${result.missingGrants.join(", ")}`);
}
```
