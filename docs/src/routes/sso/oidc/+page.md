---
title: auth.sso.admin.oidc
description:
  OIDC provider configuration — discovery, claim mapping, and sign-in
  resolution.
---

<svelte:head>

  <title>auth.sso.admin.oidc - convex-auth</title>
</svelte:head>

# auth.sso.admin.oidc

The `auth.sso.admin.oidc` namespace configures OpenID Connect identity providers
for SSO connections.

> This page documents the **server-side helper API**:
> [`auth.sso.admin.oidc.*`](/sso/oidc/) plus
> [`auth.sso.client.signIn(...)`](/sso/rpc/). Public RPC like
> [`api.auth.enterprise.configureOidc`](/sso/rpc/) only exists after your app
> exposes app-owned enterprise wrappers.

Use the `enterpriseId` returned by
[`auth.sso.admin.connection.create(...)`](/sso/connection/) when configuring
OIDC.

## Methods

| Method                          | Signature                                                                                                      | Returns                        | Description                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `auth.sso.admin.oidc.configure` | `(ctx, { enterpriseId, issuer?, discoveryUrl?, clientId, clientSecret?, scopes?, authorizationParams?, ... })` | OIDC config document           | Configures OIDC settings for a connection and stores the normalized config. |
| `auth.sso.admin.oidc.get`       | `(ctx, enterpriseId)`                                                                                          | OIDC config document           | Returns the current OIDC configuration for a connection.                    |
| `auth.sso.admin.oidc.validate`  | `(ctx, enterpriseId)`                                                                                          | `{ ok, enterpriseId, checks }` | Validates that the OIDC configuration is complete and the IdP is reachable. |
| `auth.sso.client.signIn`        | `(ctx, { enterpriseId?, email?, domain?, redirectTo? })`                                                       | Sign-in route description      | Resolves the client-facing OIDC sign-in route for a connection.             |

`clientSecret` is write-only. Configure it through
[`auth.sso.admin.oidc.configure(...)`](/sso/oidc/), but expect
[`auth.sso.admin.oidc.get(...)`](/sso/oidc/) and other public reads to return a
redacted view of the OIDC config.

## `configure` arguments

| Argument                | Type       | Description                                                                        |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `enterpriseId`          | `string`   | The SSO connection ID to configure.                                                |
| `issuer`                | `string`   | The OIDC issuer URL (e.g. `https://accounts.google.com`). Used for auto-discovery. |
| `discoveryUrl`          | `string`   | Optional explicit discovery URL when issuer-based discovery is not enough.         |
| `clientId`              | `string`   | The OAuth client ID from the IdP.                                                  |
| `clientSecret`          | `string`   | The OAuth client secret from the IdP.                                              |
| `scopes`                | `string[]` | Optional scopes override. Defaults to `openid profile email`.                      |
| `authorizationParams`   | `object?`  | Optional extra authorization parameters.                                           |
| `clockToleranceSeconds` | `number?`  | Optional tolerance for ID token clock skew.                                        |
| `strictIssuer`          | `boolean?` | Optional strict issuer matching toggle.                                            |
| `extraFields`           | `object?`  | Optional claim-to-field mapping for syncing IdP claims to user fields.             |

## Claim mapping with `extraFields`

Use `extraFields` to map custom IdP claims to user document fields:

```ts
await auth.sso.admin.oidc.configure(ctx, {
  enterpriseId,
  issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
  clientId: "...",
  clientSecret: "...",
  extraFields: {
    department: "custom:department",
    jobTitle: "custom:job_title",
  },
});
```

The keys are field names on your user document; the values are the claim names
from the IdP's ID token.

## Provider mode note

The library currently publishes issuer and JWKS metadata for provider-mode
discovery. Full provider endpoints such as `/oauth/authorize`, `/oauth/token`,
and `/userinfo` are still future work and should not be treated as generally
available yet.

## Validation

After configuring, validate that the connection is working:

```ts
const result = await auth.sso.admin.oidc.validate(ctx, enterpriseId);

if (!result.ok) {
  console.error("OIDC validation failed:", result.checks);
}
```

## Resolve a sign-in route

```ts
const route = await auth.sso.client.signIn(ctx, {
  enterpriseId,
  redirectTo: "/dashboard",
});

route.signInPath;
route.callbackPath;
```
