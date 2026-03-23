---
title: auth.sso.connection
description:
  SSO connection management — create and manage per-tenant SSO connections.
---

<svelte:head>

  <title>auth.sso.connection - convex-auth</title>
</svelte:head>

# auth.sso.connection

The `auth.sso.connection` namespace manages enterprise SSO records. Each record
links a group (tenant) to an identity provider configuration. It is also the
root namespace for enterprise domain management through
`auth.sso.connection.domain.*`. The returned `enterpriseId` is passed to the
rest of the enterprise APIs.

> This page documents the **server-side helper API**: `auth.sso.connection.*`.
> If you want client-callable admin RPC like `api.auth.sso.connection.create`,
> mount enterprise helpers or expose app-owned wrappers first.

## Methods

| Method        | Signature                                                  | Returns                     | Description                                                   |
| ------------- | ---------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `create`      | `(ctx, { groupId, slug?, name?, status?, domains?, ... })` | `{ enterpriseId, groupId }` | Creates a new SSO connection for a group.                     |
| `get`         | `(ctx, enterpriseId)`                                      | `Doc \| null`               | Fetches a connection by ID.                                   |
| `getByGroup`  | `(ctx, groupId)`                                           | `Doc \| null`               | Returns the SSO connection for a group, or `null`.            |
| `getByDomain` | `(ctx, domain)`                                            | `Doc \| null`               | Looks up a connection by email domain.                        |
| `list`        | `(ctx, { where?, limit?, cursor?, orderBy?, order? })`     | Paginated list              | Lists SSO connections with optional filtering and sorting.    |
| `update`      | `(ctx, enterpriseId, data)`                                | `void`                      | Updates connection fields (status, metadata, domains, etc.).  |
| `remove`      | `(ctx, enterpriseId)`                                      | `void`                      | Removes an SSO connection.                                    |
| `status`      | `(ctx, enterpriseId)`                                      | Status object               | Returns readiness and per-protocol status for the connection. |

## Domain methods

The `auth.sso.connection.domain` namespace manages domains owned by the
connection.

| Method                | Signature                      | Returns     | Description                                  |
| --------------------- | ------------------------------ | ----------- | -------------------------------------------- |
| `list`                | `(ctx, enterpriseId)`          | Domain list | Lists domains attached to the connection.    |
| `validate`            | `(ctx, enterpriseId)`          | Status info | Returns onboarding diagnostics for domains.  |
| `set`                 | `(ctx, enterpriseId, domains)` | `void`      | Replaces the connection's full domain set.   |
| `requestVerification` | Planned                        | -           | Domain onboarding and verification workflow. |
| `verify`              | Planned                        | -           | Verifies domain ownership for a connection.  |
| `getVerification`     | Planned                        | -           | Reads the current verification state.        |

## Example

```ts
// Create an SSO connection for a tenant
const { enterpriseId } = await auth.sso.connection.create(ctx, {
  groupId: orgId,
  slug: "acme",
  name: "Acme SSO",
  status: "active",
});

// Replace the attached enterprise domains
await auth.sso.connection.domain.set(ctx, enterpriseId, [
  { domain: "acme.com", isPrimary: true },
  { domain: "login.acme.com" },
]);

const domains = await auth.sso.connection.domain.list(ctx, enterpriseId);

// Inspect domain onboarding readiness
const diagnostics = await auth.sso.connection.domain.validate(
  ctx,
  enterpriseId,
);

// Check connection health
const status = await auth.sso.connection.status(ctx, enterpriseId);
```
