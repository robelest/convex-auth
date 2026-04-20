---
title: auth.user
description: User management — read, update, delete users and manage active groups.
---

<svelte:head>

  <title>auth.user - convex-auth</title>
</svelte:head>

# auth.user

The `auth.user` namespace provides methods for managing users. All methods
require a Convex context (`ctx`) as the first argument.

For native identity claims already available on the JWT, prefer
`ctx.auth.getUserIdentity()`. In normal app code, prefer `auth.ctx()` /
`ctx.auth.userId` when you also want the current user document or
authorization state. Raw mixed-auth HTTP handlers should use
`auth.http.context(...)`.

The `ctx.auth` examples on this page assume you created auth-aware builders such
as `authQuery`, `authMutation`, or `authAction` with `auth.ctx()` in
`convex/functions.ts`.

## Methods

| Method           | Signature                            | Returns               | Description                                                                                                                                                              |
| ---------------- | ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get`            | `(ctx, userId)`                      | `Doc<"User"> \| null` | Fetches a user document by ID.                                                                                                                                           |
| `list`           | `(ctx, { where?, limit?, cursor? })` | Paginated user list   | Lists users with optional filtering and pagination.                                                                                                                      |
| `update`         | `(ctx, userId, data)`                | `{ userId }`          | Updates fields on a user document.                                                                                                                                       |
| `viewer`         | `(ctx)`                              | `Doc<"User"> \| null` | Returns the current session user's full document, or `null` when unauthenticated.                                                                                        |
| `delete`         | `(ctx, userId, { cascade? })`        | `{ userId }`          | Deletes a user. With `cascade: true`, also deletes all linked sessions, accounts, memberships, and keys. Throws `ConvexError` with code `INVALID_PARAMETERS` on failure. |
| `setActiveGroup` | `(ctx, { userId, groupId })`         | `{ userId, groupId }` | Sets the user's active group.                                                                                                                                            |
| `getActiveGroup` | `(ctx, { userId })`                  | `Id<"Group"> \| null` | Returns the user's active group ID, or `null` if none is set.                                                                                                            |

## Examples

### Current user ID in app code

```ts
// `auth.ctx()` already validated the session.
const userId = ctx.auth.userId;
```

### Get the current user document

```ts
// `auth.ctx()` already injected the user document.
const user = ctx.auth.user;
```

### Get any user by ID

```ts
const user = await auth.user.get(ctx, userId);
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

### Advanced: raw HTTP mixed auth

```ts
const authContext = await auth.http.context(ctx, request, { optional: true });
if (authContext.userId === null) {
  return new Response("Unauthorized", { status: 401 });
}
```
