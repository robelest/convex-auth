---
title: auth.scim
description:
  SCIM 2.0 provisioning — configure directory sync and manage provisioned
  identities.
---

<svelte:head>

  <title>auth.scim - convex-auth</title>
</svelte:head>

# auth.scim

The `auth.scim` namespace configures SCIM 2.0 provisioning for automatic user
and group synchronization from an identity provider's directory.

> This page documents the **server-side helper API**: `auth.scim.*`. Public RPC
> like `api.auth.scim.configure` only exists after your app mounts enterprise
> helpers or writes explicit wrappers.

Use the `enterpriseId` returned by `auth.sso.connection.create(...)` when
configuring SCIM.

## Methods

| Method             | Signature                                                                                            | Returns                             | Description                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `configure`        | `(ctx, { enterpriseId, basePath?, status? })`                                                        | `{ token, configId }`               | Configures SCIM provisioning and returns the SCIM bearer token once. |
| `get`              | `(ctx, enterpriseId)`                                                                                | SCIM config document                | Returns the current SCIM configuration for a connection.             |
| `getConfigByToken` | `(ctx, token)`                                                                                       | SCIM config document                | Looks up a SCIM configuration by its bearer token hash.              |
| `validate`         | `(ctx, enterpriseId)`                                                                                | `{ ok, enterpriseId, checks, ... }` | Validates that the SCIM configuration is complete.                   |
| `identity.get`     | `(ctx, { enterpriseId, resourceType, externalId })`                                                  | SCIM identity document              | Fetches a provisioned identity by its external ID from the IdP.      |
| `identity.upsert`  | `(ctx, { enterpriseId, groupId, resourceType, externalId, userId?, mappedGroupId?, active?, raw? })` | `string`                            | Creates or updates a provisioned identity with the given attributes. |

## Example

### Configure SCIM for a connection

```ts
const { token } = await auth.scim.configure(ctx, {
  enterpriseId,
});

const config = await auth.scim.get(ctx, enterpriseId);

// Provide these to the customer's IdP admin:
// config?.basePath — the SCIM base URL to configure in their directory
// token         — the authorization token for SCIM requests
```

Provisioning behavior such as deprovision mode is configured through
`auth.sso.policy`, not `auth.scim.configure(...)`.

### Look up a provisioned identity

```ts
const identity = await auth.scim.identity.get(ctx, {
  enterpriseId,
  resourceType: "user",
  externalId: "user-from-idp-12345",
});
```

### Upsert a provisioned identity

```ts
await auth.scim.identity.upsert(ctx, {
  enterpriseId,
  groupId: orgId,
  resourceType: "user",
  externalId: "user-from-idp-12345",
  active: true,
  raw: {
    email: "alice@acme.com",
    displayName: "Alice Smith",
  },
});
```
