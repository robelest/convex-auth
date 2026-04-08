---
title: SSO Overview
description:
  Group Connection Single Sign-On — OIDC, SAML 2.0, and SCIM 2.0 provisioning.
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
  providers: [sso()],
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
> - The frontend auth client only needs `api.auth.signIn`, `api.auth.signOut`,
>   and `api.auth.store`.

For the common case, create a single app-owned file such as
`convex/auth/group.ts` and export the group SSO helpers your app needs.

After exporting those wrappers, frontend code can use normal Convex hooks/calls:

```ts
import { group } from "@robelest/convex-auth/server";
import { auth, authorized } from "../auth";
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

export const { createConnection, configureOidc, configureScim } = group(auth, {
  authorized,
});

const createConnection = useAction(api.auth.group.createConnection);
const configureOidc = useAction(api.auth.group.configureOidc);
const configureScim = useAction(api.auth.group.configureScim);
```

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

## Per-tenant runtime configuration

All group SSO configuration is **per-tenant runtime state** stored in your
Convex database. There is no app-level configuration file needed. Each tenant
(group) can have its own group connection record with its own IdP settings.

`auth.group.sso.connection.create(...)` returns an object with `connectionId`
and `groupId`. Use `connectionId` for the rest of the `auth.group.sso.*` APIs.

If you use the mounted flat group SSO RPC builder, configure `admin.roles` so
the creator of a newly auto-created group gets the initial grants required to
manage that tenant.

This means you can:

- Onboard new group customers without redeploying.
- Support multiple IdPs across different tenants simultaneously.
- Let tenant admins configure their own SSO via your UI.

## Current scope

The current group policy model is intentionally narrow. Today
`auth.group.sso.policy` covers:

- OIDC and SAML account linking
- SCIM user reuse
- JIT user and membership creation
- SCIM deprovision behavior

Settings like allowed auth methods, role or group mapping, domain restrictions,
and session or token policy are still better treated as app-level policy until
they become first-class library fields.

If you expose app-level SSO management functions, require tenant-admin
authorization in addition to checking that the caller is signed in.

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
