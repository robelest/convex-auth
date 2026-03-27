---
title: auth.sso.admin.saml
description:
  SAML 2.0 provider configuration — metadata exchange and assertion validation.
---

<svelte:head>

  <title>auth.sso.admin.saml - convex-auth</title>
</svelte:head>

# auth.sso.admin.saml

The `auth.sso.admin.saml` namespace configures SAML 2.0 identity providers for
SSO connections.

> This page documents the **server-side helper API**:
> [`auth.sso.admin.saml.*`](/sso/saml/). Public RPC like
> [`api.auth.enterprise.configureSaml`](/sso/rpc/) only exists after your app
> exposes app-owned enterprise wrappers.

Use the `enterpriseId` returned by
[`auth.sso.admin.connection.create(...)`](/sso/connection/) when configuring
SAML.

## Methods

| Method      | Signature                                                                                                   | Returns                     | Description                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `configure` | `(ctx, { enterpriseId, metadataXml?, metadataUrl?, domains?, signAuthnRequests?, attributeMapping?, sp? })` | `{ enterpriseId, groupId }` | Configures SAML settings for a connection. Accepts a metadata URL or raw XML.                                           |
| `metadata`  | `(ctx, { enterpriseId, entityId?, acsUrl?, sloUrl? })`                                                      | `string`                    | Returns the SP metadata XML for the connection via [`auth.sso.client.metadata(...)`](/sso/rpc/).                        |
| `validate`  | `(ctx, enterpriseId)`                                                                                       | `{ checks: [...] }`         | Validates that the SAML configuration is complete and the IdP metadata is parseable. Each check has its own `ok` field. |

## Example

### Configure with a metadata URL

```ts
await auth.sso.admin.saml.configure(ctx, {
  enterpriseId,
  metadataUrl: "https://idp.acme.com/metadata.xml",
});
```

### Configure with raw XML

```ts
await auth.sso.admin.saml.configure(ctx, {
  enterpriseId,
  metadataXml: "<EntityDescriptor ...>...</EntityDescriptor>",
});
```

### Get SP metadata

Provide this to the customer's IdP admin so they can set up the trust:

```ts
const spMetadata = await auth.sso.client.metadata(ctx, { enterpriseId });
// Returns XML string — serve this at a public URL or provide for download
```

### Validate configuration

```ts
const { checks } = await auth.sso.admin.saml.validate(ctx, enterpriseId);

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  console.error("SAML validation failed:", failures);
}
```
