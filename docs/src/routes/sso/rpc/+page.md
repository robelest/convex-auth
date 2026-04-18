---
title: Group SSO RPC
description: App-owned client-callable group SSO RPC built from convex-auth server helpers.
---

<svelte:head>

  <title>Group SSO RPC - convex-auth</title>
</svelte:head>

# Group SSO RPC

`api.auth.group.*` is an optional, app-owned RPC surface for group admin UI and
group SSO sign-in flows.

It is **not** created automatically by `createAuth(...)`.

- `auth.group.sso.*` is the server-side helper namespace
- `api.auth.group.*` exists only after your app exports Convex functions from a
  file such as `convex/auth/group.ts`

## When you need it

Use `api.auth.group.*` when your app needs client-callable functions for:

- creating and managing group SSO connections
- configuring OIDC, SAML, and SCIM from an admin UI
- validating group SSO setup from the browser
- resolving group SSO sign-in flows from app code

The mounted RPC layer mirrors the server helper model:

- protocol namespaces (`oidc`, `saml`, `scim`) configure how external identity
  is read
- `policy` decides how users and memberships are provisioned
- connection and domain helpers manage trust and onboarding state

If you only need normal sign-in/sign-out, you do **not** need this surface. The
frontend auth client still only depends on:

- `api.auth.signIn`
- `api.auth.signOut`
- `api.auth.store`

## Recommended app file

Create one app-owned file and export only what your app needs:

```ts
// convex/auth/group.ts
import { createAuthGroupSso } from "@robelest/convex-auth/server";

import { auth } from "../auth";
import { roles } from "../roles";

export const {
  createConnection,
  getConnection,
  listConnections,
  updateConnection,
  deleteConnection,
  listDomains,
  getDomainStatus,
  validateDomains,
  setDomains,
  requestDomainVerification,
  confirmDomainVerification,
  configureOidc,
  getOidc,
  getOidcStatus,
  validateOidc,
  configureSaml,
  getSaml,
  getSamlStatus,
  validateSaml,
  refreshSaml,
  getPolicy,
  updatePolicy,
  validatePolicy,
  configureScim,
  getScim,
  getScimStatus,
  validateScim,
  signIn,
  metadata,
} = createAuthGroupSso(auth, {
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
```

The mounted API keeps the same mental model as the server helpers:

- `configure*` reads external identity from a protocol
- `get*` and `get*Status` expose the current normalized state
- `updatePolicy` controls how that identity is applied
- domain helpers manage trust and onboarding

Top-level `sso.hooks` remain server-only configuration on `createAuth(...)`;
they are not part of the mounted `api.auth.group.*` RPC surface.

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

`createAuthGroupSso(auth, { access })` requires an app-owned access policy for
admin operations.

See [Authorization Patterns](/guides/authorization) for how role objects and
grant checks fit into this mounted group SSO pattern.

The access check receives a normalized access input, including:

- `userId`
- `permission`
- `connectionId?`
- `groupId?`

Example:

```ts
// convex/auth/group.ts
export const groupApi = createAuthGroupSso(auth, {
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
```

`createConnection` requires a `groupId`; creating the group remains a separate
app concern via `auth.group.create(...)` or your own app-owned wrapper.

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
- `getDomainStatus`
- `validateDomains`
- `setDomains`
- `requestDomainVerification`
- `confirmDomainVerification`

### OIDC

- `configureOidc`
- `getOidc`
- `getOidcStatus`
- `validateOidc`

### SAML

- `configureSaml`
- `getSaml`
- `getSamlStatus`
- `validateSaml`
- `refreshSaml`
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
- `getScimStatus`
- `validateScim`

### Client sign-in helpers

- `signIn`

## Example payloads

```ts
await configureOidc({
  connectionId,
  discovery: { issuer: "https://login.example.com" },
  client: { id: "client-id", secret: "client-secret" },
  request: { scopes: ["openid", "profile", "email"] },
  profile: { mapping: { email: "email", groups: "groups", roles: "roles" } },
});

await configureSaml({
  connectionId,
  metadata: { url: "https://idp.example.com/metadata.xml" },
  request: { signAuthnRequests: true },
  profile: { mapping: { subject: "UserID", email: "Email", roles: "Roles" } },
});

await configureScim({
  connectionId,
  profile: { mapping: { externalId: "externalId", email: "emails.primary" } },
});
```

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

If you need a custom public shape, skip `group(...)` and expose your own Convex
functions directly from those server helpers.

## Payload shapes

The mounted RPC helpers use the same nested protocol config shapes as the server
helpers:

- OIDC: `discovery`, `client`, `request`, `security`, `profile`
- SAML: `metadata`, `request`, `security`, `serviceProvider`, `profile`
- SCIM: `status`, `security`, `profile`

This keeps your admin UI and your server-side usage on the same mental model.
