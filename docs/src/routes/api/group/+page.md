---
title: auth.group
description:
  Group management — create, list, update, and delete hierarchical groups.
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
| `create`    | `(ctx, { name, parentId?, tags?, metadata? })` | `Id<"groups">`       | Creates a new group. Optionally nest under a parent group.                  |
| `get`       | `(ctx, groupId)`                               | `Doc<"groups">`      | Fetches a group document by ID.                                             |
| `list`      | `(ctx, { parentId?, limit?, cursor? })`        | Paginated group list | Lists groups, optionally filtered by parent.                                |
| `update`    | `(ctx, groupId, { name?, tags?, metadata? })`  | `void`               | Updates a group's name, tags, or metadata.                                  |
| `delete`    | `(ctx, groupId)`                               | `void`               | Deletes a group and all its nested children, members, and invites.          |
| `ancestors` | `(ctx, groupId)`                               | `Doc<"groups">[]`    | Returns the chain of ancestor groups from the immediate parent to the root. |

## Examples

### Create a group with tags

Tags are useful for categorizing groups (e.g. plan tier, region):

```ts
const groupId = await auth.group.create(ctx, {
  name: "Acme Corp",
  tags: ["enterprise", "us-east"],
});
```

### Create a nested group

```ts
const teamId = await auth.group.create(ctx, {
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
  tags: ["enterprise", "us-west"],
  metadata: { plan: "pro" },
});
```
