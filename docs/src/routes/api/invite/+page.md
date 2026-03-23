---
title: auth.invite
description: Invite management — create, accept, and revoke group invitations.
---

<svelte:head>

  <title>auth.invite - convex-auth</title>
</svelte:head>

# auth.invite

The `auth.invite` namespace manages invitations to groups. Invites have a status
lifecycle: `pending` -> `accepted` or `revoked`.

## Methods

| Method   | Signature                                       | Returns               | Description                                                           |
| -------- | ----------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `create` | `(ctx, { groupId, email, role, expiresAt? })`   | `Id<"invites">`       | Creates a pending invite. Optionally set an expiration timestamp.     |
| `get`    | `(ctx, inviteId)`                               | `Doc<"invites">`      | Fetches an invite document by ID.                                     |
| `list`   | `(ctx, { groupId?, status?, limit?, cursor? })` | Paginated invite list | Lists invites, optionally filtered by group and/or status.            |
| `accept` | `(ctx, inviteId)`                               | `Id<"members">`       | Accepts a pending invite, creating a membership for the invited user. |
| `revoke` | `(ctx, inviteId)`                               | `void`                | Revokes a pending invite so it can no longer be accepted.             |

## Examples

### Create and accept an invite

```ts
// Admin creates an invite
const inviteId = await auth.invite.create(ctx, {
  groupId: orgId,
  email: "alice@example.com",
  role: "member",
});

// Later, when Alice signs in and accepts:
const memberId = await auth.invite.accept(ctx, inviteId);
```

### Create an invite with expiration

```ts
const inviteId = await auth.invite.create(ctx, {
  groupId: orgId,
  email: "bob@example.com",
  role: "viewer",
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
});
```

### List pending invites for a group

```ts
const pending = await auth.invite.list(ctx, {
  groupId: orgId,
  status: "pending",
});
```

### Revoke an invite

```ts
await auth.invite.revoke(ctx, inviteId);
```
