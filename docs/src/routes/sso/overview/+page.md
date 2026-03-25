---
title: SSO Overview
description:
  Enterprise Single Sign-On — OIDC, SAML 2.0, and SCIM 2.0 provisioning.
---

<svelte:head>

  <title>SSO Overview - convex-auth</title>
</svelte:head>

# SSO Overview

Enterprise SSO is gated behind the `new SSO()` provider. The `auth.sso.*`
namespace is **only available** when `SSO` is included in your providers list:

```ts
import { createAuth } from "@robelest/convex-auth/component";
import { SSO } from "@robelest/convex-auth/providers";
import { components } from "./_generated/api";

const auth = createAuth(components.auth, {
  providers: [new SSO()],
});
```

If `SSO` is not in your providers, accessing `auth.sso` will be a TypeScript
error — the namespace does not exist on the type.

The `auth.sso.*` and `auth.scim.admin.*` namespaces are the canonical
server-side enterprise helpers. If your app wants a client-callable enterprise
management API, expose it explicitly from your Convex app. See the
[Enterprise RPC guide](/sso/rpc/).

> **Server helpers vs mounted RPC**
>
> - `auth.sso.*` and `auth.scim.admin.*` are server-side helper namespaces for
>   Convex code.
> - `api.auth.enterprise.*` is optional public RPC only after you expose
>   app-owned enterprise wrappers.
> - The frontend auth client only needs `api.auth.signIn`, `api.auth.signOut`,
>   and `api.auth.store`.

For the common case, create a single app-owned file such as
`convex/auth/enterprise.ts` and export the enterprise helpers your app needs.

After exporting those wrappers, frontend code can use normal Convex hooks/calls:

```ts
import { enterprise } from "@robelest/convex-auth/server";
import { auth, authorized } from "../auth";
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

export const { createConnection, configureOidc, configureScim } = enterprise(
  auth,
  { authorized },
);

const createConnection = useAction(api.auth.enterprise.createConnection);
const configureOidc = useAction(api.auth.enterprise.configureOidc);
const configureScim = useAction(api.auth.enterprise.configureScim);
```

These are app-owned wrappers over the server helper namespaces. You can also
skip the flat mounted surface entirely and call the server helpers directly:

```ts
// convex/admin/enterprise.ts
import { action } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "../auth";

export const createConnection = action({
  args: { groupId: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Add your own tenant-admin authorization here.
    return await auth.sso.admin.connection.create(ctx, args);
  },
});
```

## What SSO covers

| Protocol | Purpose                                  | Namespace                           |
| -------- | ---------------------------------------- | ----------------------------------- |
| OIDC     | OpenID Connect identity provider login   | [`auth.sso.admin.oidc`](/sso/oidc/) |
| SAML 2.0 | Security Assertion Markup Language login | [`auth.sso.admin.saml`](/sso/saml/) |
| SCIM 2.0 | Cross-domain user/group provisioning     | [`auth.scim.admin`](/sso/scim/)     |

## Per-tenant runtime configuration

All enterprise SSO configuration is **per-tenant runtime state** stored in your
Convex database. There is no app-level configuration file needed. Each tenant
(group) can have its own enterprise record with its own IdP settings.

`auth.sso.admin.connection.create(...)` returns an object with `enterpriseId`
and `groupId`. Use `enterpriseId` for the rest of the `auth.sso.*` APIs.

If you use the mounted flat enterprise RPC builder, configure `admin.roles` so
the creator of a newly auto-created enterprise group gets the initial grants
required to manage that tenant.

This means you can:

- Onboard new enterprise customers without redeploying.
- Support multiple IdPs across different tenants simultaneously.
- Let tenant admins configure their own SSO via your UI.

## Current scope

The current enterprise policy model is intentionally narrow. Today
`auth.sso.admin.policy` covers:

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
| [`auth.sso.admin.connection`](/sso/connection/) | Manage SSO connections per group          |
| [`auth.sso.admin.policy`](/sso/policy/)         | Manage enterprise auth behavior           |
| [`auth.sso.admin.oidc`](/sso/oidc/)             | Configure and validate OIDC providers     |
| [`auth.sso.admin.saml`](/sso/saml/)             | Configure and validate SAML 2.0 providers |
| [`auth.sso.client`](/sso/rpc/)                  | Resolve enterprise sign-in and metadata   |
| [`auth.scim.admin`](/sso/scim/)                 | Configure SCIM 2.0 provisioning           |
| [`auth.sso.admin.audit`](/sso/audit/)           | Query SSO audit events                    |
| [`auth.sso.admin.webhook`](/sso/webhook/)       | Manage webhook endpoints                  |
