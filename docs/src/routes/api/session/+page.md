---
title: auth.session
description: Session management — read, list, and invalidate sessions.
---

<svelte:head>

  <title>auth.session - convex-auth</title>
</svelte:head>

# auth.session

The `auth.session` namespace provides methods for managing user sessions.

## Methods

| Method       | Signature                    | Returns                  | Description                                                                                      |
| ------------ | ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `current`    | `(ctx)`                      | `Id<"sessions"> \| null` | Returns the current session ID from the JWT, or `null` if not authenticated.                     |
| `invalidate` | `(ctx, { userId, except? })` | `{ ok, userId, except }` | Invalidates all sessions for a user. Pass `except` with a session ID to keep one session active. |
| `get`        | `(ctx, sessionId)`           | `Doc<"sessions">`        | Fetches a session document by ID.                                                                |
| `list`       | `(ctx, { userId })`          | `Doc<"sessions">[]`      | Lists all active sessions for a user.                                                            |

## Examples

### Get the current session

```ts
const sessionId = await auth.session.current(ctx);
```

### Invalidate all other sessions

This is useful for a "sign out everywhere else" feature:

```ts
const sessionId = await auth.session.current(ctx);
const userId = await auth.user.id(ctx);

if (!userId || !sessionId) {
  throw new Error("Not signed in");
}

await auth.session.invalidate(ctx, {
  userId,
  except: sessionId,
});
```

### List all sessions for a user

```ts
const userId = await auth.user.id(ctx);
if (!userId) {
  throw new Error("Not signed in");
}
const sessions = await auth.session.list(ctx, { userId });
```
