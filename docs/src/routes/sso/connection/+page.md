---
title: auth.group.sso.connection
description:
  SSO connection management — create and manage per-tenant SSO connections.
---

<svelte:head>

  <title>auth.group.sso.connection - convex-auth</title>
</svelte:head>

# auth.group.sso.connection

The `auth.group.sso.connection` namespace manages group SSO records. Each
record links a group (tenant) to an identity provider configuration. It is also
the root namespace for group connection domain management through
[`auth.group.sso.connection.domain.*`](/sso/connection/). The returned
`connectionId` is passed to the rest of the group SSO APIs.

> This page documents the **server-side helper API**:
> [`auth.group.sso.connection.*`](/sso/connection/). If you want client-callable
> admin RPC like [`api.auth.group.createConnection`](/sso/rpc/), expose
> app-owned group SSO wrappers first.

## Methods

| Method        | Signature                                                  | Returns                     | Description                                                   |
| ------------- | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `create`      | `(ctx, { groupId, slug?, name?, status?, domains?, ... })` | `{ connectionId, groupId }` | Creates a new SSO connection for a group.                     |
| `get`         | `(ctx, connectionId)`                                      | `Doc \| null`               | Fetches a connection by ID.                                   |
| `getByDomain` | `(ctx, domain)`                                            | `Doc \| null`               | Looks up a connection by email domain.                        |
| `list`        | `(ctx, { where?, limit?, cursor?, orderBy?, order? })`     | Paginated list              | Lists SSO connections with optional filtering and sorting.    |
| `update`      | `(ctx, connectionId, data)`                                | `{ connectionId }`          | Updates connection fields (status, metadata, domains, etc.).  |
| `delete`      | `(ctx, connectionId)`                                      | `{ connectionId }`          | Deletes an SSO connection.                                    |
| `status`      | `(ctx, connectionId)`                                      | Status object               | Returns readiness and per-protocol status for the connection. |

## Domain methods

The [`auth.group.sso.connection.domain`](/sso/connection/) namespace manages
domains owned by the connection.

| Method                 | Signature                         | Returns                     | Description                                                                 |
| ---------------------- | --------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `list`                 | `(ctx, connectionId)`             | Domain list                 | Lists domains attached to the connection.                                   |
| `validate`             | `(ctx, connectionId)`             | Status info                 | Returns onboarding diagnostics for domains.                                 |
| `set`                  | `(ctx, connectionId, domains)`    | `{ connectionId, domains }` | Replaces the connection's full domain set and returns the canonical result. |
| `verification.request` | `(ctx, { connectionId, domain })` | Verification challenge      | Issues a DNS TXT verification challenge for an attached domain.             |
| `verification.confirm` | `(ctx, { connectionId, domain })` | Confirmation result         | Resolves the TXT record and marks the domain verified on success.           |

## Example

```ts
// Create an SSO connection for a tenant
const { connectionId } = await auth.group.sso.connection.create(ctx, {
  groupId: orgId,
  slug: "acme",
  name: "Acme SSO",
  status: "active",
});

// Replace the attached group connection domains
const domainResult = await auth.group.sso.connection.domain.set(
  ctx,
  connectionId,
  [{ domain: "acme.com", isPrimary: true }, { domain: "login.acme.com" }],
);

const challenge = await auth.group.sso.connection.domain.verification.request(
  ctx,
  {
    connectionId,
    domain: "acme.com",
  },
);

const confirmation =
  await auth.group.sso.connection.domain.verification.confirm(ctx, {
    connectionId,
    domain: "acme.com",
  });

const domains = await auth.group.sso.connection.domain.list(ctx, connectionId);

// Inspect domain onboarding readiness
const diagnostics = await auth.group.sso.connection.domain.validate(
  ctx,
  connectionId,
);

// Check connection health
const status = await auth.group.sso.connection.status(ctx, connectionId);
```
