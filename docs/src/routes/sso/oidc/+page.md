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
> [`api.auth.group.configureOidc`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
OIDC.

## Methods

| Method                          | Signature                                                                                                      | Returns                   | Description                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `auth.group.sso.oidc.configure` | `(ctx, { connectionId, issuer?, discoveryUrl?, clientId, clientSecret?, scopes?, authorizationParams?, ... })` | OIDC config document      | Configures OIDC settings for a connection and stores the normalized config.                                      |
| `auth.group.sso.oidc.get`       | `(ctx, connectionId)`                                                                                          | OIDC config document      | Returns the current OIDC configuration for a connection.                                                         |
| `auth.group.sso.oidc.validate`  | `(ctx, connectionId)`                                                                                          | `{ checks: [...] }`       | Validates that the OIDC configuration is complete and the IdP is reachable. Each check has its own `ok` field.   |
| `auth.group.sso.signIn`               | `(ctx, { connectionId?, email?, domain?, redirectTo? })`                                                       | Sign-in route description | Resolves the client-facing OIDC sign-in route for a connection. Domain/email routing requires a verified domain. |

`clientSecret` is write-only. Configure it through
[`auth.group.sso.oidc.configure(...)`](/sso/oidc/), but expect
[`auth.group.sso.oidc.get(...)`](/sso/oidc/) and other public reads to return a
redacted view of the OIDC config.

## `configure` arguments

| Argument                | Type       | Description                                                                        |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `connectionId`          | `string`   | The SSO connection ID to configure.                                                |
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
await auth.group.sso.oidc.configure(ctx, {
  connectionId,
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
const { checks } = await auth.group.sso.oidc.validate(ctx, connectionId);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error("OIDC validation failed:", failures);
}
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
