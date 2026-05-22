---
title: auth.group
description: Group management — create, list, update, and delete hierarchical groups.
---

<svelte:head>

  <title>auth.group - convex-auth</title>
</svelte:head>

# auth.group

The `auth.group` namespace provides methods for managing groups (organizations,
teams, workspaces, etc.). Groups can be nested to form a hierarchy.

## Methods

| Method      | Signature                                      | Returns              | Description                                                                 |
| ----------- | ---------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| `create`    | `(ctx, { name, parentId?, tags?, metadata? })` | `{ groupId }`        | Creates a new group. Optionally nest under a parent group.                  |
| `get`       | `(ctx, groupId)`                               | `Doc<"groups">`      | Fetches a group document by ID.                                             |
| `list`      | `(ctx, { parentId?, limit?, cursor? })`        | `PaginationResult<Doc<"Group">>` — `{ page, isDone, continueCursor }` | Lists groups, optionally filtered by parent. Convex-native shape. |
| `update`    | `(ctx, groupId, { name?, tags?, metadata? })`  | `{ groupId }`        | Updates a group's name, tags, or metadata.                                  |
| `delete`    | `(ctx, groupId)`                               | `{ groupId }`        | Deletes a group and all its nested children, members, and invites.          |
| `ancestors` | `(ctx, groupId)`                               | `Doc<"groups">[]`    | Returns the chain of ancestor groups from the immediate parent to the root. |

## Examples

### Create a group with tags

Tags are useful for categorizing groups (e.g. plan tier, region):

```ts
const { groupId } = await auth.group.create(ctx, {
  name: "Acme Corp",
  tags: ["group-sso", "us-east"],
});
```

### Create a nested group

```ts
const { groupId: teamId } = await auth.group.create(ctx, {
  name: "Engineering",
  parentId: orgId,
  tags: ["team"],
});
```

### Walk the hierarchy

```ts
const ancestors = await auth.group.ancestors(ctx, teamId);
// [{ _id: orgId, name: "Acme Corp", ... }]
```

### Update group metadata

```ts
await auth.group.update(ctx, groupId, {
  tags: ["group-sso", "us-west"],
  metadata: { plan: "pro" },
});
```

## Denormalized fields

Groups include two denormalized fields maintained automatically:

| Field         | Type          | Description                                                                 |
| ------------- | ------------- | --------------------------------------------------------------------------- |
| `rootGroupId` | `Id<"Group">` | The root ancestor of this group. Self-referencing for root groups.          |
| `isRoot`      | `boolean`     | `true` when the group has no parent. Used for efficient root group queries. |

These fields are computed at creation time and cascaded on hierarchy changes.
You can use them for efficient queries like listing all root groups:

```ts
const workspaces = await auth.group.list(ctx, {
  where: { isRoot: true },
});
```
