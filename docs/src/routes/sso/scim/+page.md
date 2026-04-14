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

The `auth.group.sso.scim` namespace configures SCIM 2.0 provisioning for
automatic user and group synchronization from an identity provider's directory.

> This page documents the **server-side helper API**:
> [`auth.group.sso.scim.*`](/sso/scim/). Public RPC like
> [`api.auth.group.configureScim`](/sso/rpc/) only exists after your app exposes
> app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
SCIM.

The SCIM base URL is derived from your app's public site URL and the connection
ID. It is not an app-managed override.

The current SCIM surface is intentionally vendor-agnostic and focused on the
common interoperability subset:

- Users and Groups resources
- `PATCH` and `PUT`
- filters: `eq`, `co`, `sw`, `ew`, `pr`
- idempotent provisioning by `externalId`
- no `Bulk`
- no `ETag`

## Methods

| Method      | Signature                                               | Returns                                       | Description                                                                                         |
| ----------- | ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `configure` | `(ctx, { connectionId, status?, security?, profile? })` | `{ connectionId, token, configId, basePath }` | Configures SCIM provisioning and returns the SCIM bearer token once.                                |
| `get`       | `(ctx, connectionId)`                                   | SCIM config document                          | Returns the current SCIM configuration for a connection.                                            |
| `status`    | `(ctx, connectionId)`                                   | `{ configured, ready, ... }`                  | Returns a lightweight readiness summary for a connection.                                           |
| `validate`  | `(ctx, connectionId)`                                   | `{ checks: [...], capabilities }`             | Validates that the SCIM configuration is complete and returns the supported SCIM capability subset. |

## Example

### Configure SCIM for a connection

```ts
const { token } = await auth.group.sso.scim.configure(ctx, {
  connectionId,
  security: {
    maxRequestSize: 200_000,
  },
  profile: {
    mapping: {
      externalId: "externalId",
      email: "emails.primary",
      name: "displayName",
      active: "active",
    },
    extraFields: {
      department:
        "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department",
    },
  },
});

const config = await auth.group.sso.scim.get(ctx, connectionId);

// Provide these to the customer's IdP admin:
// config?.basePath — the SCIM base URL to configure in their directory
// token         — the authorization token for SCIM requests
```

The normalized SCIM profile then flows into
[`auth.group.sso.policy`](/sso/policy/) and optional `sso.hooks`, so extraction
stays separate from provisioning rules.

When `profile.mapping.groups` or `profile.mapping.roles` are configured,
external values can map into membership `roleIds` through policy.

## Status

```ts
const status = await auth.group.sso.scim.status(ctx, connectionId);

status.configured;
status.ready;
status.capabilities;
status.checks;
```

Provisioning behavior such as deprovision mode is configured through
[`auth.group.sso.policy`](/sso/policy/), not
[`auth.group.sso.scim.configure(...)`](/sso/scim/).
