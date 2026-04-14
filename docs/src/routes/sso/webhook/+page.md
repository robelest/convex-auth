---
title: auth.group.sso.webhook
description: SSO webhooks — manage group webhook endpoints.
---

<svelte:head>

  <title>auth.group.sso.webhook - convex-auth</title>
</svelte:head>

# auth.group.sso.webhook

The `auth.group.sso.webhook` namespace manages group webhook endpoints for
SSO-related events.

> This page documents the **server-side helper API**:
> [`auth.group.sso.webhook.*`](/sso/webhook/). Public RPC like
> [`api.auth.group.createWebhookEndpoint`](/sso/rpc/) only exists after your app
> exposes app-owned group SSO wrappers.

## Endpoint methods

| Method             | Signature                                                               | Returns          | Description                                                                               |
| ------------------ | ----------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `endpoint.create`  | `(ctx, { connectionId, url, secret, subscriptions, createdByUserId? })` | `{ endpointId }` | Creates a webhook endpoint that listens for specific events.                              |
| `endpoint.list`    | `(ctx, connectionId)`                                                   | Endpoint[]       | Lists all webhook endpoints for a connection.                                             |
| `endpoint.disable` | `(ctx, endpointId)`                                                     | `{ endpointId }` | Disables a webhook endpoint (stops delivery). Throws `ConvexError` if endpoint not found. |

## Example

### Set up a webhook endpoint

```ts
const { endpointId } = await auth.group.sso.webhook.endpoint.create(ctx, {
  connectionId,
  url: "https://api.acme.com/webhooks/sso",
  subscriptions: ["group.sso.oidc.registered", "group.sso.scim.configured"],
  secret: "whsec_...",
});
```

### Disable an endpoint

```ts
await auth.group.sso.webhook.endpoint.disable(ctx, endpointId);
```
