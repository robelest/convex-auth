---
title: auth.group.sso.oidc
description:
  OIDC provider configuration — discovery, claim mapping, and sign-in
  resolution.
---

<svelte:head>

  <title>auth.group.sso.oidc - convex-auth</title>
</svelte:head>

# auth.group.sso.oidc

The `auth.group.sso.oidc` namespace configures OpenID Connect identity providers
for SSO connections.

> This page documents the **server-side helper API**:
> [`auth.group.sso.oidc.*`](/sso/oidc/) plus
> [`auth.group.sso.signIn(...)`](/sso/rpc/). Public RPC like
> [`api.auth.group.configureOidc`](/sso/rpc/) only exists after your app exposes
> app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
OIDC.

## Methods

| Method                          | Signature                                                                   | Returns                      | Description                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `auth.group.sso.oidc.configure` | `(ctx, { connectionId, discovery, client, request?, security?, profile? })` | OIDC config document         | Configures OIDC settings for a connection and stores the normalized config.                                      |
| `auth.group.sso.oidc.get`       | `(ctx, connectionId)`                                                       | OIDC config document         | Returns the current OIDC configuration for a connection.                                                         |
| `auth.group.sso.oidc.status`    | `(ctx, connectionId)`                                                       | `{ configured, ready, ... }` | Returns a lightweight readiness summary for a connection.                                                        |
| `auth.group.sso.oidc.validate`  | `(ctx, connectionId)`                                                       | `{ checks: [...] }`          | Validates that the OIDC configuration is complete and the IdP is reachable. Each check has its own `ok` field.   |
| `auth.group.sso.signIn`         | `(ctx, { connectionId?, email?, domain?, redirectTo?, loginHint? })`        | Sign-in route description    | Resolves the client-facing OIDC sign-in route for a connection. Domain/email routing requires a verified domain. |

`clientSecret` is write-only. Configure it through
[`auth.group.sso.oidc.configure(...)`](/sso/oidc/), but expect
[`auth.group.sso.oidc.get(...)`](/sso/oidc/) and other public reads to return a
redacted view of the OIDC config.

If you use `sso({ redirectURI })`, multiple OIDC connections can share a single
callback URL while still routing back to the correct connection via the encoded
OIDC state.

## `configure` shape

```ts
await auth.group.sso.oidc.configure(ctx, {
  connectionId,
  discovery: {
    issuer: "https://login.example.com",
    discoveryUrl: "https://login.example.com/.well-known/openid-configuration",
    jwksUri: "https://login.example.com/keys",
    audience: ["client-id"],
  },
  client: {
    id: "client-id",
    secret: "client-secret",
    authMethod: "client_secret_basic",
  },
  request: {
    scopes: ["openid", "profile", "email"],
    loginHint: "user@example.com",
    authorizationParams: { prompt: "login" },
  },
  security: {
    clockToleranceSeconds: 300,
    strictIssuer: true,
  },
  profile: {
    mapping: {
      subject: "sub",
      email: "preferred_username",
      name: "display_name",
      groups: "groups",
      roles: "roles",
    },
    extraFields: {
      department: "department",
    },
  },
});
```

## Claim mapping

Use `profile.mapping` to override the core OIDC claims used for the built-in
profile:

```ts
await auth.group.sso.oidc.configure(ctx, {
  connectionId,
  discovery: {
    issuer: "https://login.example.com",
  },
  client: {
    id: "...",
    secret: "...",
  },
  profile: {
    mapping: {
      subject: "sub",
      email: "preferred_username",
      name: "display_name",
    },
  },
});
```

Use `profile.extraFields` to map additional IdP claims to `user.extend` fields:

```ts
await auth.group.sso.oidc.configure(ctx, {
  connectionId,
  discovery: {
    issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
  },
  client: {
    id: "...",
    secret: "...",
  },
  profile: {
    extraFields: {
      department: "custom:department",
      jobTitle: "custom:job_title",
    },
  },
});
```

The keys are field names on your user document; the values are the claim names
from the IdP's ID token.

The normalized OIDC profile then flows into
[`auth.group.sso.policy`](/sso/policy/) and optional `sso.hooks`, so extraction
and provisioning stay separate.

## Login hints

Use `loginHint` to send a stable hint to the IdP, or pass it at sign-in time:

```ts
const route = await auth.group.sso.signIn(ctx, {
  connectionId,
  redirectTo: "/dashboard",
  loginHint: "user@example.com",
});

route.signInPath;
```

## Provider mode note

The library currently publishes issuer and JWKS metadata for provider-mode
discovery. Full provider endpoints such as `/oauth/authorize`, `/oauth/token`,
and `/userinfo` are still future work and should not be treated as generally
available yet.

## Validation

After configuring, validate that the connection is working:

```ts
const { checks } = await auth.group.sso.oidc.validate(ctx, connectionId);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error("OIDC validation failed:", failures);
}
```

## Status

```ts
const status = await auth.group.sso.oidc.status(ctx, connectionId);

status.configured;
status.ready;
status.checks;
```

## Resolve a sign-in route

```ts
const route = await auth.group.sso.signIn(ctx, {
  connectionId,
  redirectTo: "/dashboard",
});

route.signInPath;
route.callbackPath;
```
