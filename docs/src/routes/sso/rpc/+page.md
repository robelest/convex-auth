---
title: Enterprise RPC
description:
  App-owned client-callable enterprise RPC built from convex-auth server
  helpers.
---

<svelte:head>

  <title>Enterprise RPC - convex-auth</title>
</svelte:head>

# Enterprise RPC

`api.auth.enterprise.*` is an optional, app-owned RPC surface for enterprise
admin UI and enterprise sign-in flows.

It is **not** created automatically by `createAuth(...)`.

- `auth.sso.*` and `auth.scim.admin.*` are server-side helper namespaces
- `api.auth.enterprise.*` exists only after your app exports Convex functions
  from a file such as `convex/auth/enterprise.ts`

## When you need it

Use `api.auth.enterprise.*` when your app needs client-callable functions for:

- creating and managing enterprise SSO connections
- configuring OIDC, SAML, and SCIM from an admin UI
- validating enterprise setup from the browser
- resolving enterprise sign-in flows from app code

If you only need normal sign-in/sign-out, you do **not** need this surface. The
frontend auth client still only depends on:

- `api.auth.signIn`
- `api.auth.signOut`
- `api.auth.store`

## Recommended app file

Create one app-owned file and export only what your app needs:

```ts
// convex/auth/enterprise.ts
import { enterprise } from "@robelest/convex-auth/server";

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
} = enterprise(auth, {
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

const createConnection = useAction(api.auth.enterprise.createConnection);
const configureOidc = useAction(api.auth.enterprise.configureOidc);
const configureScim = useAction(api.auth.enterprise.configureScim);

const signIn = useQuery(api.auth.enterprise.signIn, {
  domain: "acme.com",
  redirectTo: "/dashboard",
});
```

## Authorization

`enterprise(auth, { admin: { authorized, roles? } })` requires an app-owned
authorization callback for admin operations.

When `createConnection` creates a new group automatically, `admin.roles` are
assigned to the creator's initial membership in that group.

See [Authorization Patterns](/guides/authorization) for how role objects and
grant checks fit into this mounted enterprise pattern.

The callback receives a normalized authorization input, including:

- `userId`
- `permission`
- `enterpriseId?`
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

The flat enterprise RPC builder exposes verb-first functions:

### Connection

- `createConnection`
- `getConnection`
- `getConnectionByGroup`
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

- `auth.sso.admin.connection.*`
- `auth.sso.admin.oidc.*`
- `auth.sso.admin.saml.*`
- `auth.sso.admin.policy.*`
- `auth.sso.admin.audit.*`
- `auth.sso.admin.webhook.*`
- `auth.sso.client.*`
- `auth.scim.admin.*`

If you need a custom public shape, skip `enterprise(...)` and expose your own
Convex functions directly from those server helpers.
