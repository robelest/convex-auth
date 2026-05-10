---
title: SSO Overview
description: Group Connection Single Sign-On — OIDC, SAML 2.0, and SCIM 2.0 provisioning.
---

<svelte:head>

  <title>SSO Overview - convex-auth</title>
</svelte:head>

# SSO Overview

Group SSO is gated behind the `sso()` provider. The `auth.group.sso.*` namespace
is **only available** when `SSO` is included in your providers list:

```ts
import { createAuth } from "@robelest/convex-auth/component";
import { sso } from "@robelest/convex-auth/providers";
import { components } from "./_generated/api";

const auth = createAuth(components.auth, {
  providers: [
    sso({
      redirectURI: "/auth/sso/callback",
    }),
  ],
});
```

If `SSO` is not in your providers, accessing `auth.group.sso` will be a
TypeScript error — the namespace does not exist on the type.

The `auth.group.sso.*` and `auth.group.sso.scim.*` namespaces are the canonical
server-side group SSO helpers. If your app wants a client-callable group SSO
management API, expose it explicitly from your Convex app. See the
[Group SSO RPC guide](/sso/rpc/).

> **Server helpers vs mounted RPC**
>
> - `auth.group.sso.*` and `auth.group.sso.scim.*` are server-side helper
>   namespaces for Convex code.
> - `api.auth.group.*` is optional public RPC only after you expose app-owned
>   group SSO wrappers.
> - The frontend auth client only needs `api.auth.signIn` and
>   `api.auth.signOut`.

For the common case, create a single app-owned file such as
`convex/auth/group.ts` and export the group SSO helpers your app needs.

After exporting those wrappers, frontend code can use normal Convex hooks/calls:

```ts
import { createAuthGroupSso } from "@robelest/convex-auth/server";
import { auth } from "../auth";
import { roles } from "../roles";
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export const { createConnection, configureOidc, configureScim } = createAuthGroupSso(auth, {
  permissions: {
    sso: { require: [roles.orgAdmin] },
    scim: { require: [roles.orgAdmin] },
  },
  access: async (ctx, input, requiredRoles) => {
    if (!input.groupId) {
      throw new Error("Group scope required");
    }
    await auth.member.require(ctx, {
      userId: input.userId,
      groupId: input.groupId,
      roleIds: requiredRoles.map((role) => role.id),
    });
  },
});

const createConnection = useAction(api.auth.group.createConnection);
const configureOidc = useAction(api.auth.group.configureOidc);
const configureScim = useAction(api.auth.group.configureScim);
const signIn = useQuery(api.auth.group.signIn, {
  domain: "acme.com",
  redirectTo: "/dashboard",
});
```

`createConnection` requires a `groupId`, so create the group first or read it
from the current route/context before calling the mounted RPC.

These are app-owned wrappers over the server helper namespaces. You can also
skip the flat mounted surface entirely and call the server helpers directly:

```ts
// convex/auth/group.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "../auth";

export const createConnection = action({
  args: { groupId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Add your own tenant-admin authorization here.
    return await auth.group.sso.connection.create(ctx, args);
  },
});
```

## What SSO covers

| Protocol | Purpose                                  | Namespace                           |
| -------- | ---------------------------------------- | ----------------------------------- |
| OIDC     | OpenID Connect identity provider login   | [`auth.group.sso.oidc`](/sso/oidc/) |
| SAML 2.0 | Security Assertion Markup Language login | [`auth.group.sso.saml`](/sso/saml/) |
| SCIM 2.0 | Cross-domain user/group provisioning     | [`auth.group.sso.scim`](/sso/scim/) |

## Unified model

All three protocols now follow the same mental model:

1. Protocol config extracts external identity
2. [`auth.group.sso.policy`](/sso/policy/) decides how that identity is applied
3. Verified domains establish trust for discovery and safe linking
4. Optional `sso.hooks` run on normalized profiles during provisioning

That means:

- OIDC / SAML / SCIM configure how to read external identity
- `policy` decides how users, memberships, and deprovisioning behave
- domains decide whether a connection is trusted for domain-based discovery
- hooks let your app customize the normalized provisioning pipeline

## Per-tenant runtime configuration

All group SSO configuration is **per-tenant runtime state** stored in your
Convex database. There is no app-level configuration file needed. Each tenant
(group) can have its own group connection record with its own IdP settings.

`auth.group.sso.connection.create(...)` returns an object with `connectionId`
and `groupId`. Use `connectionId` for the rest of the `auth.group.sso.*` APIs.

If you use the mounted flat group SSO RPC builder, create the group first and
then call `createConnection({ groupId, ... })` with your app's access policy.

This means you can:

- Onboard new group customers without redeploying.
- Support multiple IdPs across different tenants simultaneously.
- Let tenant admins configure their own SSO via your UI.

## Current policy scope

Today `auth.group.sso.policy` covers:

- OIDC and SAML account linking
- user creation and profile authority
- SCIM user reuse
- JIT user and membership creation
- groups and roles mapping into membership `roleIds`
- SCIM deprovision behavior

Protocol-specific transport and validation settings stay in:

- [`auth.group.sso.oidc`](/sso/oidc/)
- [`auth.group.sso.saml`](/sso/saml/)
- [`auth.group.sso.scim`](/sso/scim/)

`groups` and `roles` currently map external values into membership `roleIds`.
They do not create or mirror nested app groups automatically.

If you expose app-level SSO management functions, require tenant-admin
authorization in addition to checking that the caller is signed in.

## Hooks

You can optionally attach normalized SSO hooks at auth creation time:

```ts
const auth = createAuth(components.auth, {
  providers: [sso()],
  sso: {
    hooks: {
      profileResolved: async ({ protocol, profile }) => profile,
      beforeProvision: async ({ protocol, profile }) => profile,
      afterProvision: async ({ protocol, userId }) => {},
      allowLink: async ({ protocol, userId, profile }) => true,
    },
  },
});
```

These hooks run on normalized profile objects rather than raw OIDC claims, SAML
attributes, or SCIM request bodies.

Use hooks when your app needs small provisioning customizations without pushing
tenant-specific logic down into protocol config.

## Related namespaces

| Namespace                                       | Purpose                                   |
| ----------------------------------------------- | ----------------------------------------- |
| [`auth.group.sso.connection`](/sso/connection/) | Manage SSO connections per group          |
| [`auth.group.sso.policy`](/sso/policy/)         | Manage group SSO behavior                 |
| [`auth.group.sso.oidc`](/sso/oidc/)             | Configure and validate OIDC providers     |
| [`auth.group.sso.saml`](/sso/saml/)             | Configure and validate SAML 2.0 providers |
| [`auth.group.sso.signIn`](/sso/rpc/)            | Resolve group SSO sign-in routes          |
| [`auth.group.sso.metadata`](/sso/rpc/)          | Generate SAML SP metadata                 |
| [`auth.group.sso.scim`](/sso/scim/)             | Configure SCIM 2.0 provisioning           |
| [`auth.group.sso.audit`](/sso/audit/)           | Query SSO audit events                    |
| [`auth.group.sso.webhook`](/sso/webhook/)       | Manage webhook endpoints                  |
