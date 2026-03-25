---
title: auth.sso.admin.connection
description:
  SSO connection management — create and manage per-tenant SSO connections.
---

<svelte:head>

  <title>auth.sso.admin.connection - convex-auth</title>
</svelte:head>

# auth.sso.admin.connection

The `auth.sso.admin.connection` namespace manages enterprise SSO records. Each
record links a group (tenant) to an identity provider configuration. It is also
the root namespace for enterprise domain management through
[`auth.sso.admin.connection.domain.*`](/sso/connection/). The returned
`enterpriseId` is passed to the rest of the enterprise APIs.

> This page documents the **server-side helper API**:
> [`auth.sso.admin.connection.*`](/sso/connection/). If you want client-callable
> admin RPC like [`api.auth.enterprise.createConnection`](/sso/rpc/), expose
> app-owned enterprise wrappers first.

## Methods

| Method        | Signature                                                  | Returns                         | Description                                                   |
| ------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------- |
| `create`      | `(ctx, { groupId, slug?, name?, status?, domains?, ... })` | `{ ok, enterpriseId, groupId }` | Creates a new SSO connection for a group.                     |
| `get`         | `(ctx, enterpriseId)`                                      | `Doc \| null`                   | Fetches a connection by ID.                                   |
| `getByGroup`  | `(ctx, groupId)`                                           | `Doc \| null`                   | Returns the SSO connection for a group, or `null`.            |
| `getByDomain` | `(ctx, domain)`                                            | `Doc \| null`                   | Looks up a connection by email domain.                        |
| `list`        | `(ctx, { where?, limit?, cursor?, orderBy?, order? })`     | Paginated list                  | Lists SSO connections with optional filtering and sorting.    |
| `update`      | `(ctx, enterpriseId, data)`                                | `{ ok, enterpriseId }`          | Updates connection fields (status, metadata, domains, etc.).  |
| `delete`      | `(ctx, enterpriseId)`                                      | `{ ok, enterpriseId }`          | Deletes an SSO connection.                                    |
| `status`      | `(ctx, enterpriseId)`                                      | Status object                   | Returns readiness and per-protocol status for the connection. |

## Domain methods

The [`auth.sso.admin.connection.domain`](/sso/connection/) namespace manages
domains owned by the connection.

| Method                 | Signature                         | Returns                         | Description                                                                 |
| ---------------------- | --------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `list`                 | `(ctx, enterpriseId)`             | Domain list                     | Lists domains attached to the connection.                                   |
| `validate`             | `(ctx, enterpriseId)`             | Status info                     | Returns onboarding diagnostics for domains.                                 |
| `set`                  | `(ctx, enterpriseId, domains)`    | `{ ok, enterpriseId, domains }` | Replaces the connection's full domain set and returns the canonical result. |
| `verification.request` | `(ctx, { enterpriseId, domain })` | Verification challenge          | Issues a DNS TXT verification challenge for an attached domain.             |
| `verification.confirm` | `(ctx, { enterpriseId, domain })` | Confirmation result             | Resolves the TXT record and marks the domain verified on success.           |

## Example

```ts
// Create an SSO connection for a tenant
const { enterpriseId } = await auth.sso.admin.connection.create(ctx, {
  groupId: orgId,
  slug: "acme",
  name: "Acme SSO",
  status: "active",
});

// Replace the attached enterprise domains
const domainResult = await auth.sso.admin.connection.domain.set(
  ctx,
  enterpriseId,
  [{ domain: "acme.com", isPrimary: true }, { domain: "login.acme.com" }],
);

const challenge = await auth.sso.admin.connection.domain.verification.request(
  ctx,
  {
    enterpriseId,
    domain: "acme.com",
  },
);

const confirmation =
  await auth.sso.admin.connection.domain.verification.confirm(ctx, {
    enterpriseId,
    domain: "acme.com",
  });

const domains = await auth.sso.admin.connection.domain.list(ctx, enterpriseId);

// Inspect domain onboarding readiness
const diagnostics = await auth.sso.admin.connection.domain.validate(
  ctx,
  enterpriseId,
);

// Check connection health
const status = await auth.sso.admin.connection.status(ctx, enterpriseId);
```
