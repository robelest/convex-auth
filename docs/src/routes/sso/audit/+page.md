---
title: auth.sso.audit
description: SSO audit log — record and query authentication events.
---

<svelte:head>

  <title>auth.sso.audit - convex-auth</title>
</svelte:head>

# auth.sso.audit

The `auth.sso.audit` namespace records and queries SSO-related audit events. Use
this to build audit logs for compliance, debugging, and security monitoring.

> This page documents the **server-side helper API**: `auth.sso.audit.*`. Public
> RPC like `api.auth.sso.audit.list` only exists after your app mounts
> enterprise helpers or writes explicit wrappers.

## Methods

| Method   | Signature                                                                                            | Returns  | Description                                                    |
| -------- | ---------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| `record` | `(ctx, { enterpriseId, groupId, eventType, actorType, actorId?, subjectType, subjectId?, ok, ... })` | `string` | Records an audit event (e.g. sign-in, sign-out, provisioning). |
| `list`   | `(ctx, { enterpriseId?, groupId?, limit? })`                                                         | Event[]  | Lists audit events with optional enterprise/group filters.     |

## Example

### Record an event

```ts
await auth.sso.audit.record(ctx, {
  enterpriseId,
  groupId: orgId,
  eventType: "enterprise.oidc.registered",
  actorType: "user",
  actorId: userId,
  subjectType: "enterprise_oidc",
  ok: true,
  metadata: { ip: "192.168.1.1" },
});
```

### Query audit logs

```ts
// List all events for an SSO connection
const logs = await auth.sso.audit.list(ctx, {
  enterpriseId,
  limit: 50,
});

// List all events for a tenant group
const userLogs = await auth.sso.audit.list(ctx, {
  groupId: orgId,
});
```
