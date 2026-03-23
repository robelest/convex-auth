---
title: auth.sso.admin.audit
description: SSO audit log query helpers for enterprise admin tooling.
---

<svelte:head>

  <title>auth.sso.admin.audit - convex-auth</title>
</svelte:head>

# auth.sso.admin.audit

The `auth.sso.admin.audit` namespace exposes read-only audit log queries for
enterprise admin tooling.

> This page documents the **server-side helper API**: `auth.sso.admin.audit.*`.
> Public RPC like `api.auth.sso.admin.audit.list` only exists after your app
> mounts enterprise helpers or writes explicit wrappers.

## Methods

| Method | Signature                                    | Returns | Description                                                |
| ------ | -------------------------------------------- | ------- | ---------------------------------------------------------- |
| `list` | `(ctx, { enterpriseId?, groupId?, limit? })` | Event[] | Lists audit events with optional enterprise/group filters. |

## Example

### Query audit logs

```ts
// List all events for an SSO connection
const logs = await auth.sso.admin.audit.list(ctx, {
  enterpriseId,
  limit: 50,
});

// List all events for a tenant group
const userLogs = await auth.sso.admin.audit.list(ctx, {
  groupId: orgId,
});
```
