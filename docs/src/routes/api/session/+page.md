---
title: auth.session
description: Session management — read, list, and invalidate sessions.
---

<svelte:head>

  <title>auth.session - convex-auth</title>
</svelte:head>

# auth.session

The `auth.session` namespace provides methods for managing user sessions.

The `ctx.auth` examples on this page assume the handler is using `auth.ctx()`-
backed builders such as `authQuery`, `authMutation`, or `authAction`.

## Methods

| Method       | Signature                    | Returns                  | Description                                                                                         |
| ------------ | ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `current`    | `(ctx)`                      | `Id<"Session"> \| null`  | Returns the current session ID from the JWT, or `null` if not authenticated.                        |
| `invalidate` | `(ctx, { userId, except? })` | `{ userId, except }`     | Invalidates all sessions for a user. Pass `except` as an array of session IDs to keep those active. |
| `get`        | `(ctx, sessionId)`           | `Doc<"Session"> \| null` | Fetches a session document by ID.                                                                   |
| `list`       | `(ctx, { userId })`          | `Doc<"Session">[]`       | Lists all sessions for a user.                                                                      |

## Examples

### Get the current session

```ts
const sessionId = await auth.session.current(ctx);
```

### Invalidate all other sessions

This is useful for a "sign out everywhere else" feature:

```ts
const sessionId = await auth.session.current(ctx);
if (sessionId === null) {
  throw new Error("Current session missing");
}

await auth.session.invalidate(ctx, {
  userId: ctx.auth.userId,
  except: [sessionId],
});
```

### List all sessions for a user

```ts
const sessions = await auth.session.list(ctx, { userId: ctx.auth.userId });
```
