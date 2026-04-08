---
title: auth.group.sso.scim
description:
  SCIM 2.0 provisioning — configure directory sync and manage provisioned
  identities.
---

<svelte:head>

  <title>auth.group.sso.scim - convex-auth</title>
</svelte:head>

# auth.group.sso.scim

The `auth.group.sso.scim` namespace configures SCIM 2.0 provisioning for automatic
user and group synchronization from an identity provider's directory.

> This page documents the **server-side helper API**:
> [`auth.group.sso.scim.*`](/sso/scim/). Public RPC like
> [`api.auth.group.configureScim`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
SCIM.

## Methods

| Method      | Signature                                     | Returns                                       | Description                                                                           |
| ----------- | --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `configure` | `(ctx, { connectionId, basePath?, status? })` | `{ connectionId, token, configId, basePath }` | Configures SCIM provisioning and returns the SCIM bearer token once.                  |
| `get`       | `(ctx, connectionId)`                         | SCIM config document                          | Returns the current SCIM configuration for a connection.                              |
| `validate`  | `(ctx, connectionId)`                         | `{ checks: [...] }`                           | Validates that the SCIM configuration is complete. Each check has its own `ok` field. |

## Example

### Configure SCIM for a connection

```ts
const { token } = await auth.group.sso.scim.configure(ctx, {
  connectionId,
});

const config = await auth.group.sso.scim.get(ctx, connectionId);

// Provide these to the customer's IdP admin:
// config?.basePath — the SCIM base URL to configure in their directory
// token         — the authorization token for SCIM requests
```

Provisioning behavior such as deprovision mode is configured through
[`auth.group.sso.policy`](/sso/policy/), not
[`auth.group.sso.scim.configure(...)`](/sso/scim/).
