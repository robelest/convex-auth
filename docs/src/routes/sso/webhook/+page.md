---
title: auth.sso.admin.webhook
description: SSO webhooks — manage enterprise webhook endpoints.
---

<svelte:head>

  <title>auth.sso.admin.webhook - convex-auth</title>
</svelte:head>

# auth.sso.admin.webhook

The `auth.sso.admin.webhook` namespace manages enterprise webhook endpoints for
SSO-related events.

> This page documents the **server-side helper API**:
> [`auth.sso.admin.webhook.*`](/sso/webhook/). Public RPC like
> [`api.auth.enterprise.createWebhookEndpoint`](/sso/rpc/) only exists after
> your app exposes app-owned enterprise wrappers.

## Endpoint methods

| Method             | Signature                                                               | Returns              | Description                                                  |
| ------------------ | ----------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `endpoint.create`  | `(ctx, { enterpriseId, url, secret, subscriptions, createdByUserId? })` | `{ endpointId }`     | Creates a webhook endpoint that listens for specific events. |
| `endpoint.list`    | `(ctx, enterpriseId)`                                                   | Endpoint[]           | Lists all webhook endpoints for a connection.                |
| `endpoint.disable` | `(ctx, endpointId)`                                                     | `{ ok, endpointId }` | Disables a webhook endpoint (stops delivery).                |

## Example

### Set up a webhook endpoint

```ts
const { endpointId } = await auth.sso.admin.webhook.endpoint.create(ctx, {
  enterpriseId,
  url: "https://api.acme.com/webhooks/sso",
  subscriptions: ["enterprise.oidc.registered", "enterprise.scim.configured"],
  secret: "whsec_...",
});
```

### Disable an endpoint

```ts
await auth.sso.admin.webhook.endpoint.disable(ctx, endpointId);
```
