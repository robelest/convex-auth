---
title: auth.group.sso.policy
description: Group policy management — centralize account linking, SCIM reuse, JIT, and
  deprovision behavior.
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
> [`api.auth.group.updatePolicy`](/sso/rpc/) only exists after your app exposes
> app-owned group SSO wrappers.

Connector mechanics stay in [`auth.group.sso.oidc`](/sso/oidc/),
[`auth.group.sso.saml`](/sso/saml/), and [`auth.group.sso.scim`](/sso/scim/).

`auth.group.sso.policy` is where you define how normalized external identity is
applied to your app:

- account linking
- user creation and profile-update authority
- SCIM reuse
- JIT membership creation
- group and role sync policy
- deprovision behavior

## Methods

| Method     | Signature               | Returns                 | Description                                                                   |
| ---------- | ----------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `get`      | `(ctx, groupId)`        | `GroupConnectionPolicy` | Returns the canonical policy for a group.                                     |
| `update`   | `(ctx, groupId, patch)` | `GroupConnectionPolicy` | Applies a partial update and returns the new policy.                          |
| `validate` | `(ctx, groupId)`        | `{ checks: [...] }`     | Validates the policy document for a group. Each check has its own `ok` field. |

## Default policy

```ts
const policy = await auth.group.sso.policy.get(ctx, groupId);

policy.identity.accountLinking.oidc; // "verifiedEmail"
policy.identity.accountLinking.saml; // "verifiedEmail"
policy.provisioning.user.createOnSignIn; // true
policy.provisioning.user.updateProfileOnLogin; // "missing"
policy.provisioning.user.updateProfileFromScim; // "always"
policy.provisioning.user.authority; // "app"
policy.provisioning.scimReuse.user; // "externalId"
policy.provisioning.jit.mode; // "createUserAndMembership"
policy.provisioning.jit.defaultRoleIds; // ["member"]
policy.provisioning.groups.mode; // "ignore"
policy.provisioning.roles.mode; // "ignore"
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
    user: {
      updateProfileOnLogin: "always",
      authority: "sso",
    },
    jit: {
      mode: "createUser",
      defaultRoleIds: ["member"],
    },
    groups: {
      mode: "sync",
      mapping: {
        engineering: ["member"],
      },
    },
    roles: {
      mode: "map",
      mapping: {
        admin: ["owner"],
      },
    },
    deprovision: {
      mode: "hard",
    },
  },
});
```

## What belongs here

- account linking behavior
- user profile authority and update behavior
- SCIM user reuse behavior
- JIT provisioning behavior
- group sync behavior
- role sync behavior
- deprovision behavior

Not first-class yet:

- allowed auth methods
- domain restrictions
- session or token policy

Connector settings such as OIDC issuer URLs, client secrets, SAML metadata, and
SCIM bearer tokens remain in their respective
[`auth.group.sso.oidc`](/sso/oidc/), [`auth.group.sso.saml`](/sso/saml/), and
[`auth.group.sso.scim`](/sso/scim/) configuration APIs.

`provisioning.groups` and `provisioning.roles` currently map external protocol
values into membership `roleIds`. They do not create or mirror nested app groups
automatically.

If you need app-specific tweaks after protocol extraction but before
provisioning, use top-level `sso.hooks` on `createAuth(...)` rather than
overloading policy with transport-specific logic.
