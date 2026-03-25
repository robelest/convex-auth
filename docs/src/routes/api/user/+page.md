---
title: auth.user
description:
  User management — read, update, delete users and manage active groups.
---

<svelte:head>

  <title>auth.user - convex-auth</title>
</svelte:head>

# auth.user

The `auth.user` namespace provides methods for managing users. All methods
require a Convex context (`ctx`) as the first argument.

## Methods

| Method           | Signature                            | Returns                   | Description                                                                                                 |
| ---------------- | ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`             | `(ctx, request?)`                    | `string \| null`          | Returns the current user's ID or `null`. Checks the session JWT first, then falls back to API key `Bearer`. |
| `get`            | `(ctx, userId)`                      | `Doc<"users">`            | Fetches a user document by ID.                                                                              |
| `list`           | `(ctx, { where?, limit?, cursor? })` | Paginated user list       | Lists users with optional filtering, pagination.                                                            |
| `update`         | `(ctx, userId, data)`                | `{ ok, userId }`          | Updates fields on a user document.                                                                          |
| `viewer`         | `(ctx)`                              | `Doc<"users">`            | Returns the currently authenticated user's full document.                                                   |
| `delete`         | `(ctx, userId, { cascade? })`        | `{ ok, userId }`          | Deletes a user. With `cascade: true`, also deletes all linked sessions, accounts, memberships, and keys.    |
| `setActiveGroup` | `(ctx, { userId, groupId })`         | `{ ok, userId, groupId }` | Sets the user's active group.                                                                               |
| `getActiveGroup` | `(ctx, { userId })`                  | `Id<"groups"> \| null`    | Returns the user's active group ID, or `null` if none is set.                                               |

## Examples

### Get the current user

```ts
const userId = await auth.user.id(ctx);
if (!userId) {
  // Not signed in
}
```

### Get the authenticated user's document

```ts
const userId = await auth.user.id(ctx);
if (userId) {
  const user = await auth.user.get(ctx, userId);
}
```

### Get the viewer's document

```ts
const user = await auth.user.viewer(ctx);
```

### Delete a user with cascade

```ts
await auth.user.delete(ctx, userId, { cascade: true });
```

### Active group

```ts
await auth.user.setActiveGroup(ctx, {
  userId,
  groupId: orgId,
});

const activeGroup = await auth.user.getActiveGroup(ctx, { userId });
```
