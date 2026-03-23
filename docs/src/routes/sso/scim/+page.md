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

The `auth.scim.admin` namespace configures SCIM 2.0 provisioning for automatic
user and group synchronization from an identity provider's directory.

> This page documents the **server-side helper API**: `auth.scim.admin.*`.
> Public RPC like `api.auth.scim.admin.configure` only exists after your app
> mounts enterprise helpers or writes explicit wrappers.

Use the `enterpriseId` returned by `auth.sso.admin.connection.create(...)` when
configuring SCIM.

## Methods

| Method      | Signature                                     | Returns                             | Description                                                          |
| ----------- | --------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `configure` | `(ctx, { enterpriseId, basePath?, status? })` | `{ token, configId }`               | Configures SCIM provisioning and returns the SCIM bearer token once. |
| `get`       | `(ctx, enterpriseId)`                         | SCIM config document                | Returns the current SCIM configuration for a connection.             |
| `validate`  | `(ctx, enterpriseId)`                         | `{ ok, enterpriseId, checks, ... }` | Validates that the SCIM configuration is complete.                   |

## Example

### Configure SCIM for a connection

```ts
const { token } = await auth.scim.admin.configure(ctx, {
  enterpriseId,
});

const config = await auth.scim.admin.get(ctx, enterpriseId);

// Provide these to the customer's IdP admin:
// config?.basePath — the SCIM base URL to configure in their directory
// token         — the authorization token for SCIM requests
```

Provisioning behavior such as deprovision mode is configured through
`auth.sso.admin.policy`, not `auth.scim.admin.configure(...)`.
