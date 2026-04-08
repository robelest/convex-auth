---
title: auth.group.sso.policy
description:
  Group policy management — centralize account linking, SCIM reuse, JIT,
  and deprovision behavior.
---

<svelte:head>

  <title>auth.group.sso.policy - convex-auth</title>
</svelte:head>

# auth.group.sso.policy

The `auth.group.sso.policy` namespace manages group SSO behavior for a group.
Use it to configure how OIDC and SAML account linking works, how
SCIM-provisioned users are reused, whether JIT membership is created on sign-in,
and how deprovisioning behaves.

> This page documents the **server-side helper API**:
> [`auth.group.sso.policy.*`](/sso/policy/). Public RPC like
> [`api.auth.group.updatePolicy`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

This policy surface is deliberately small today. Keep connector mechanics in
[`auth.group.sso.oidc`](/sso/oidc/), [`auth.group.sso.saml`](/sso/saml/), and
[`auth.group.sso.scim`](/sso/scim/), and keep broader tenant access rules in your
application until dedicated policy fields land.

## Methods

| Method     | Signature                    | Returns             | Description                                                                        |
| ---------- | ---------------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `get`      | `(ctx, groupId)`             | `GroupConnectionPolicy` | Returns the canonical policy for a group.                                      |
| `update`   | `(ctx, groupId, patch)`      | `GroupConnectionPolicy` | Applies a partial update and returns the new policy.                            |
| `validate` | `(ctx, groupId)`             | `{ checks: [...] }` | Validates the policy document for a group. Each check has its own `ok` field.      |

## Default policy

```ts
const policy = await auth.group.sso.policy.get(ctx, groupId);

policy.identity.accountLinking.oidc; // "verifiedEmail"
policy.identity.accountLinking.saml; // "verifiedEmail"
policy.provisioning.scimReuse.user; // "externalId"
policy.provisioning.jit.mode; // "createUserAndMembership"
policy.provisioning.jit.defaultRoleIds; // ["member"]
policy.provisioning.deprovision.mode; // "soft"
```

## Example

```ts
await auth.group.sso.policy.update(ctx, groupId, {
  identity: {
    accountLinking: {
      saml: "none",
    },
  },
  provisioning: {
    jit: {
      mode: "createUser",
      defaultRoleIds: ["member"],
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
SCIM bearer tokens remain in their respective
[`auth.group.sso.oidc`](/sso/oidc/), [`auth.group.sso.saml`](/sso/saml/), and
[`auth.group.sso.scim`](/sso/scim/) configuration APIs.
