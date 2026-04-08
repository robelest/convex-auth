---
title: auth.group.sso.saml
description:
  SAML 2.0 provider configuration — metadata exchange and assertion validation.
---

<svelte:head>

  <title>auth.group.sso.saml - convex-auth</title>
</svelte:head>

# auth.group.sso.saml

The `auth.group.sso.saml` namespace configures SAML 2.0 identity providers for
SSO connections.

> This page documents the **server-side helper API**:
> [`auth.group.sso.saml.*`](/sso/saml/). Public RPC like
> [`api.auth.group.configureSaml`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

Use the `connectionId` returned by
[`auth.group.sso.connection.create(...)`](/sso/connection/) when configuring
SAML.

## Methods

| Method      | Signature                                                                                                   | Returns                     | Description                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `configure` | `(ctx, { connectionId, metadataXml?, metadataUrl?, domains?, signAuthnRequests?, attributeMapping?, sp? })` | `{ connectionId, groupId }` | Configures SAML settings for a connection. Accepts a metadata URL or raw XML.                                           |
| `metadata`  | `(ctx, { connectionId, entityId?, acsUrl?, sloUrl? })`                                                      | `string`                    | Returns the SP metadata XML for the connection via [`auth.group.sso.metadata(...)`](/sso/rpc/).                               |
| `validate`  | `(ctx, connectionId)`                                                                                       | `{ checks: [...] }`         | Validates that the SAML configuration is complete and the IdP metadata is parseable. Each check has its own `ok` field. |

## Example

### Configure with a metadata URL

```ts
await auth.group.sso.saml.configure(ctx, {
  connectionId,
  metadataUrl: "https://idp.acme.com/metadata.xml",
});
```

### Configure with raw XML

```ts
await auth.group.sso.saml.configure(ctx, {
  connectionId,
  metadataXml: "<EntityDescriptor ...>...</EntityDescriptor>",
});
```

### Get SP metadata

Provide this to the customer's IdP admin so they can set up the trust:

```ts
const spMetadata = await auth.group.sso.metadata(ctx, { connectionId });
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
