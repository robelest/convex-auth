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
`auth.request.context(...)`.

The `ctx.auth` examples on this page assume you created auth-aware builders such
as `authQuery`, `authMutation`, or `authAction` with `auth.ctx()` in
`convex/functions.ts`.

`get`, `list`, and `viewer` are fully typed (`Doc<"User">`,
`{ items: Doc<"User">[]; nextCursor }`), and the `extend` field is typed when
configured. Pair them with `auth.v.*` as your function `returns:` — see
[Typed Returns](/reference/typed-returns).

## Methods

| Method           | Signature                            | Returns               | Description                                                                                                                                                              |
| ---------------- | ------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get`            | `(ctx, userId)`                      | `Doc<"User"> \| null` | Fetches a user document by ID.                                                                                                                                           |
| `list`           | `(ctx, { where?, limit?, cursor? })` | Paginated user list   | Lists users with optional filtering and pagination.                                                                                                                      |
| `update`         | `(ctx, userId, data)`                | `{ userId }`          | Updates fields on a user document.                                                                                                                                       |
| `viewer`         | `(ctx)`                              | `Doc<"User"> \| null` | Returns the current session user's full document, or `null` when unauthenticated.                                                                                        |
| `delete`         | `(ctx, userId, { cascade? })`        | `{ userId }`          | Deletes a user. With `cascade: true`, also deletes all linked sessions, accounts, memberships, keys, and owned emails. Throws `ConvexError` with code `INVALID_PARAMETERS` on failure. |

> Active-group selection lives on the dedicated [`auth.active`](#active-group)
> namespace (`get` / `set` / `clear`), not on `auth.user`.

### `auth.user.email`

Provider-agnostic management of every email a user owns (across OAuth, SSO,
and SCIM). The collection is exposed via `.list`; `User.email` remains the
single denormalized primary pointer.

| Method      | Signature                       | Returns                  | Description                                                                                                   |
| ----------- | ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `list`      | `(ctx, { userId? })`            | `Doc<"UserEmail">[]`     | Every email the user owns, with provenance (`source`, `connectionId`, `verificationTime`, `isPrimary`).       |
| `add`       | `(ctx, email, { userId? })`     | `{ email }`              | Records an **unverified** address. Does not verify (verification stays proof-driven) and does not become primary. |
| `remove`    | `(ctx, email, { userId? })`     | `{ email }`              | Deletes an address. Throws if it is the primary, the only verified email, or a connection-managed row.        |
| `primary`   | `(ctx, { userId? })`            | `Doc<"UserEmail"> \| null` | Reads the current primary email.                                                                            |
| `primary`   | `(ctx, email, { userId? })`     | `{ email }`              | Promotes a **verified** address to primary (syncs `User.email`).                                              |

`userId` defaults to the current session user everywhere.

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
const authContext = await auth.request.context(ctx, request, { optional: true });
if (authContext.userId === null) {
  return new Response("Unauthorized", { status: 401 });
}
```
