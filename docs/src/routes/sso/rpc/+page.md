---
title: Group SSO RPC
description:
  App-owned client-callable group SSO RPC built from convex-auth server
  helpers.
---

<svelte:head>

  <title>Group SSO RPC - convex-auth</title>
</svelte:head>

# Group SSO RPC

`api.auth.group.*` is an optional, app-owned RPC surface for group
admin UI and group SSO sign-in flows.

It is **not** created automatically by `createAuth(...)`.

- `auth.group.sso.*` is the server-side helper namespace
- `api.auth.group.*` exists only after your app exports Convex functions
  from a file such as `convex/auth/group.ts`

## When you need it

Use `api.auth.group.*` when your app needs client-callable functions for:

- creating and managing group SSO connections
- configuring OIDC, SAML, and SCIM from an admin UI
- validating group SSO setup from the browser
- resolving group SSO sign-in flows from app code

If you only need normal sign-in/sign-out, you do **not** need this surface. The
frontend auth client still only depends on:

- `api.auth.signIn`
- `api.auth.signOut`
- `api.auth.store`

## Recommended app file

Create one app-owned file and export only what your app needs:

```ts
// convex/auth/group.ts
import { group } from "@robelest/convex-auth/server";

import { auth, authorized } from "../auth";

export const {
  createConnection,
  getConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  listDomains,
  validateDomains,
  setDomains,
  requestDomainVerification,
  confirmDomainVerification,
  configureOidc,
  getOidc,
  validateOidc,
  configureSaml,
  validateSaml,
  getPolicy,
  updatePolicy,
  validatePolicy,
  configureScim,
  getScim,
  validateScim,
  signIn,
  metadata,
} = group(auth, {
  admin: {
    authorized,
    roles: [roles.orgAdmin],
  },
});
```

## Client usage

Once exported, the functions show up in your generated Convex API like any other
app-owned functions:

```ts
import { useAction, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

const createConnection = useAction(api.auth.group.createConnection);
const configureOidc = useAction(api.auth.group.configureOidc);
const configureScim = useAction(api.auth.group.configureScim);

const signIn = useQuery(api.auth.group.signIn, {
  domain: "acme.com",
  redirectTo: "/dashboard",
});
```

## Authorization

`group(auth, { admin: { authorized, roles? } })` requires an app-owned
authorization callback for admin operations.

When `createConnection` creates a new group automatically, `admin.roles` are
assigned to the creator's initial membership in that group.

See [Authorization Patterns](/guides/authorization) for how role objects and
grant checks fit into this mounted group SSO pattern.

The callback receives a normalized authorization input, including:

- `userId`
- `permission`
- `connectionId?`
- `groupId?`
- `resolvedGroupId`

Example:

```ts
// convex/auth.ts
export async function authorized(
  ctx: any,
  input: {
    userId: string;
    permission: string;
    resolvedGroupId: string | null;
  },
) {
  if (input.resolvedGroupId === null) {
    return;
  }

  await auth.member.require(ctx, {
    userId: input.userId,
    groupId: input.resolvedGroupId,
    grants: [input.permission],
  });
}
```

## What gets exported

The flat group SSO RPC builder exposes verb-first functions:

### Connection

- `createConnection`
- `getConnection`
- `getConnectionByDomain`
- `listConnections`
- `updateConnection`
- `deleteConnection`
- `getConnectionStatus`

### Domains

- `listDomains`
- `validateDomains`
- `setDomains`
- `requestDomainVerification`
- `confirmDomainVerification`

### OIDC

- `configureOidc`
- `getOidc`
- `validateOidc`

### SAML

- `configureSaml`
- `validateSaml`
- `metadata`

### Policy

- `getPolicy`
- `updatePolicy`
- `validatePolicy`

### Audit and Webhooks

- `listAudit`
- `createWebhookEndpoint`
- `listWebhookEndpoints`
- `disableWebhookEndpoint`

### SCIM

- `configureScim`
- `getScim`
- `validateScim`

### Client sign-in helpers

- `signIn`

## Relationship to server helpers

The flat RPC surface is only a convenience layer over the structured server
helpers:

- `auth.group.sso.connection.*`
- `auth.group.sso.oidc.*`
- `auth.group.sso.saml.*`
- `auth.group.sso.policy.*`
- `auth.group.sso.audit.*`
- `auth.group.sso.webhook.*`
- `auth.group.sso.signIn`
- `auth.group.sso.metadata`
- `auth.group.sso.scim.*`

If you need a custom public shape, skip `group(...)` and expose your own
Convex functions directly from those server helpers.
