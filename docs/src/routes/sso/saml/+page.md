---
title: auth.sso.saml
description:
  SAML 2.0 provider configuration — metadata exchange and assertion validation.
---

<svelte:head>

  <title>auth.sso.saml - convex-auth</title>
</svelte:head>

# auth.sso.saml

The `auth.sso.saml` namespace configures SAML 2.0 identity providers for SSO
connections.

> This page documents the **server-side helper API**: `auth.sso.saml.*`. Public
> RPC like `api.auth.sso.saml.configure` only exists after your app mounts
> enterprise helpers or writes explicit wrappers.

Use the `enterpriseId` returned by `auth.sso.connection.create(...)` when
configuring SAML.

## Methods

| Method      | Signature                                                                                                   | Returns                        | Description                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| `configure` | `(ctx, { enterpriseId, metadataXml?, metadataUrl?, domains?, signAuthnRequests?, attributeMapping?, sp? })` | `{ enterpriseId, groupId }`    | Configures SAML settings for a connection. Accepts a metadata URL or raw XML.        |
| `metadata`  | `(ctx, { enterpriseId, entityId?, acsUrl?, sloUrl? })`                                                      | `string`                       | Returns the SP (Service Provider) metadata XML for the connection.                   |
| `validate`  | `(ctx, enterpriseId)`                                                                                       | `{ ok, enterpriseId, checks }` | Validates that the SAML configuration is complete and the IdP metadata is parseable. |

## Example

### Configure with a metadata URL

```ts
await auth.sso.saml.configure(ctx, {
  enterpriseId,
  metadataUrl: "https://idp.acme.com/metadata.xml",
});
```

### Configure with raw XML

```ts
await auth.sso.saml.configure(ctx, {
  enterpriseId,
  metadataXml: "<EntityDescriptor ...>...</EntityDescriptor>",
});
```

### Get SP metadata

Provide this to the customer's IdP admin so they can set up the trust:

```ts
const spMetadata = await auth.sso.saml.metadata(ctx, { enterpriseId });
// Returns XML string — serve this at a public URL or provide for download
```

### Validate configuration

```ts
const result = await auth.sso.saml.validate(ctx, enterpriseId);

if (!result.ok) {
  console.error("SAML validation failed:", result.checks);
}
```
