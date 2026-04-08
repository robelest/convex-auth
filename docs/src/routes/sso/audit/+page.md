---
title: auth.group.sso.audit
description: SSO audit log query helpers for group SSO admin tooling.
---

<svelte:head>

  <title>auth.group.sso.audit - convex-auth</title>
</svelte:head>

# auth.group.sso.audit

The `auth.group.sso.audit` namespace exposes read-only audit log queries for
group SSO admin tooling.

> This page documents the **server-side helper API**:
> [`auth.group.sso.audit.*`](/sso/audit/). Public RPC like
> [`api.auth.group.listAudit`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

## Methods

| Method | Signature                                    | Returns | Description                                                |
| ------ | -------------------------------------------- | ------- | ---------------------------------------------------------- |
| `list` | `(ctx, { connectionId?, groupId?, limit? })` | Event[] | Lists audit events with optional connection/group filters. |

## Example

### Query audit logs

```ts
// List all events for an SSO connection
const logs = await auth.group.sso.audit.list(ctx, {
  connectionId,
  limit: 50,
});

// List all events for a tenant group
const userLogs = await auth.group.sso.audit.list(ctx, {
  groupId: orgId,
});
```
