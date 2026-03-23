---
title: auth.sso.policy
description:
  Enterprise policy management — centralize account linking, SCIM reuse, JIT,
  and deprovision behavior.
---

<svelte:head>

  <title>auth.sso.policy - convex-auth</title>
</svelte:head>

# auth.sso.policy

The `auth.sso.policy` namespace manages enterprise behavior for an SSO
connection. Use it to configure how OIDC and SAML account linking works, how
SCIM-provisioned users are reused, whether JIT membership is created on sign-in,
and how deprovisioning behaves.

> This page documents the **server-side helper API**: `auth.sso.policy.*`.
> Public RPC like `api.auth.sso.policy.update` only exists after your app mounts
> enterprise helpers or writes explicit wrappers.

This policy surface is deliberately small today. Keep connector mechanics in
`auth.sso.oidc`, `auth.sso.saml`, and `auth.scim`, and keep broader tenant
access rules in your application until dedicated policy fields land.

## Methods

| Method     | Signature                    | Returns                                | Description                                          |
| ---------- | ---------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `get`      | `(ctx, enterpriseId)`        | `EnterprisePolicy`                     | Returns the canonical policy for a connection.       |
| `update`   | `(ctx, enterpriseId, patch)` | `EnterprisePolicy`                     | Applies a partial update and returns the new policy. |
| `validate` | `(ctx, enterpriseId)`        | `{ ok, enterpriseId, checks, policy }` | Validates the policy document for a connection.      |

## Default policy

```ts
const policy = await auth.sso.policy.get(ctx, enterpriseId);

policy.identity.accountLinking.oidc; // "verifiedEmail"
policy.identity.accountLinking.saml; // "verifiedEmail"
policy.provisioning.scimReuse.user; // "externalId"
policy.provisioning.jit.mode; // "createUserAndMembership"
policy.provisioning.jit.defaultRole; // "member"
policy.provisioning.deprovision.mode; // "soft"
```

## Example

```ts
await auth.sso.policy.update(ctx, enterpriseId, {
  identity: {
    accountLinking: {
      saml: "none",
    },
  },
  provisioning: {
    jit: {
      mode: "createUser",
      defaultRole: "member",
    },
    deprovision: {
      mode: "hard",
    },
  },
});
```

## What belongs here

- account linking behavior
- SCIM user reuse behavior
- JIT provisioning behavior
- deprovision behavior

Not first-class yet:

- allowed auth methods
- role or group mapping
- domain restrictions
- session or token policy

Connector settings such as OIDC issuer URLs, client secrets, SAML metadata, and
SCIM bearer tokens remain in their respective `auth.sso.oidc`, `auth.sso.saml`,
and `auth.scim` configuration APIs.
