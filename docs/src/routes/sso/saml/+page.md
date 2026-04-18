---
title: auth.group.sso.saml
description: SAML 2.0 provider configuration — metadata exchange and assertion validation.
---

<svelte:head>

  <title>auth.group.sso.saml - convex-auth</title>
</svelte:head>

# auth.group.sso.saml

The `auth.group.sso.saml` namespace configures SAML 2.0 identity providers for
SSO connections.

> This page documents the **server-side helper API**:
> [`auth.group.sso.saml.*`](/sso/saml/). Public RPC like
> [`api.auth.group.configureSaml`](/sso/rpc/) only exists after your app exposes
> app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
SAML.

## Methods

| Method      | Signature                                                                                      | Returns                      | Description                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `configure` | `(ctx, { connectionId, metadata, domains?, request?, security?, serviceProvider?, profile? })` | `{ connectionId, groupId }`  | Configures SAML settings for a connection. Accepts a metadata URL or raw XML.                                           |
| `get`       | `(ctx, connectionId)`                                                                          | SAML config document         | Returns the current normalized SAML config for a connection.                                                            |
| `status`    | `(ctx, connectionId)`                                                                          | `{ configured, ready, ... }` | Returns a lightweight readiness summary for a connection.                                                               |
| `metadata`  | `(ctx, { connectionId, entityId?, acsUrl?, sloUrl? })`                                         | `string`                     | Returns the SP metadata XML for the connection via [`auth.group.sso.metadata(...)`](/sso/rpc/).                         |
| `validate`  | `(ctx, connectionId)`                                                                          | `{ checks: [...] }`          | Validates that the SAML configuration is complete and the IdP metadata is parseable. Each check has its own `ok` field. |
| `refresh`   | `(ctx, { connectionId })`                                                                      | `{ connectionId, groupId }`  | Re-fetches metadata from the configured `metadataUrl` and updates the stored IdP metadata.                              |

## Example

### Configure with a metadata URL

```ts
await auth.group.sso.saml.configure(ctx, {
  connectionId,
  metadata: {
    url: "https://idp.acme.com/metadata.xml",
  },
});
```

### Configure with raw XML

```ts
await auth.group.sso.saml.configure(ctx, {
  connectionId,
  metadata: {
    xml: "<EntityDescriptor ...>...</EntityDescriptor>",
  },
});
```

### Optional security settings

```ts
await auth.group.sso.saml.configure(ctx, {
  connectionId,
  metadata: {
    url: "https://idp.acme.com/metadata.xml",
  },
  request: {
    signAuthnRequests: true,
  },
  profile: {
    mapping: {
      subject: "UserID",
      email: "Email",
      name: "FullName",
      groups: "Groups",
      roles: "Roles",
    },
  },
  security: {
    requireSignedAssertions: true,
    requireTimestamps: true,
    clockSkewSeconds: 300,
    weakAlgorithmHandling: "reject",
    maxMetadataSize: 100_000,
    maxResponseSize: 200_000,
  },
});
```

Supported security options:

- `requireSignedAssertions`: reject assertions that do not include an assertion
  signature
- `requireTimestamps`: require SAML time conditions (`NotBefore`/`NotOnOrAfter`)
- `clockSkewSeconds`: tolerated clock drift when validating assertion time
  windows
- `weakAlgorithmHandling`: `"warn"` or `"reject"` weak algorithms like SHA-1
- `maxMetadataSize`: reject oversized IdP metadata payloads during
  configure/refresh
- `maxResponseSize`: reject oversized SAML responses before parsing

Use `profile.mapping` to normalize the core SAML attributes used for the
built-in profile. `groups` and `roles` can feed into
[`auth.group.sso.policy`](/sso/policy/) to map external values into membership
`roleIds`.

The normalized SAML profile also flows through optional `sso.hooks`, so profile
extraction stays separate from provisioning behavior.

### Get SP metadata

Provide this to the customer's IdP admin so they can set up the trust:

```ts
const spMetadata = await auth.group.sso.saml.metadata(ctx, { connectionId });
// Returns XML string — serve this at a public URL or provide for download
```

### Validate configuration

```ts
const { checks } = await auth.group.sso.saml.validate(ctx, connectionId);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error("SAML validation failed:", failures);
}
```

### Status

```ts
const status = await auth.group.sso.saml.status(ctx, connectionId);

status.configured;
status.ready;
status.checks;
```

### Refresh metadata from `metadataUrl`

```ts
await auth.group.sso.saml.refresh(ctx, { connectionId });
```
