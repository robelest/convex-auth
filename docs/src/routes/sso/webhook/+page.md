---
title: auth.sso.webhook
description: SSO webhooks — manage endpoints, emit events, and track delivery.
---

<svelte:head>

  <title>auth.sso.webhook - convex-auth</title>
</svelte:head>

# auth.sso.webhook

The `auth.sso.webhook` namespace manages webhook endpoints and event delivery
for SSO-related events. Use webhooks to notify external systems of
authentication and provisioning events.

> This page documents the **server-side helper API**: `auth.sso.webhook.*`.
> Public RPC like `api.auth.sso.webhook.endpoint.create` only exists after your
> app mounts enterprise helpers or writes explicit wrappers.

## Endpoint methods

| Method             | Signature                                                               | Returns          | Description                                                  |
| ------------------ | ----------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------ |
| `endpoint.create`  | `(ctx, { enterpriseId, url, secret, subscriptions, createdByUserId? })` | `{ endpointId }` | Creates a webhook endpoint that listens for specific events. |
| `endpoint.list`    | `(ctx, enterpriseId)`                                                   | Endpoint[]       | Lists all webhook endpoints for a connection.                |
| `endpoint.disable` | `(ctx, endpointId)`                                                     | `void`           | Disables a webhook endpoint (stops delivery).                |

## Emit

| Method | Signature                                                    | Returns | Description                                              |
| ------ | ------------------------------------------------------------ | ------- | -------------------------------------------------------- |
| `emit` | `(ctx, { enterpriseId, eventType, payload, auditEventId? })` | `void`  | Emits an event to all active endpoints subscribed to it. |

## Delivery methods

| Method                   | Signature                                                                | Returns    | Description                                     |
| ------------------------ | ------------------------------------------------------------------------ | ---------- | ----------------------------------------------- |
| `delivery.list`          | `(ctx, { enterpriseId, limit? })`                                        | Delivery[] | Lists delivery attempts for a connection.       |
| `delivery.listReady`     | `(ctx, limit?)`                                                          | Delivery[] | Lists deliveries that are ready to be sent.     |
| `delivery.markDelivered` | `(ctx, deliveryId, responseStatus?)`                                     | `void`     | Marks a delivery as successfully delivered.     |
| `delivery.markFailed`    | `(ctx, deliveryId, { attemptCount, responseStatus?, error?, retryAt? })` | `void`     | Marks a delivery as failed with retry metadata. |

## Example

### Set up a webhook endpoint

```ts
const { endpointId } = await auth.sso.webhook.endpoint.create(ctx, {
  enterpriseId,
  url: "https://api.acme.com/webhooks/sso",
  subscriptions: ["enterprise.oidc.registered", "enterprise.scim.configured"],
  secret: "whsec_...",
});
```

### Emit an event

```ts
await auth.sso.webhook.emit(ctx, {
  enterpriseId,
  eventType: "enterprise.scim.configured",
  payload: {
    userId,
    enterpriseId,
    email: "alice@acme.com",
  },
});
```

### Process deliveries

```ts
// Get deliveries ready to send
const ready = await auth.sso.webhook.delivery.listReady(ctx, 10);

for (const delivery of ready) {
  try {
    // Send the webhook (in an action)
    await fetch(delivery.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(delivery.payload),
    });

    await auth.sso.webhook.delivery.markDelivered(ctx, delivery._id);
  } catch (error) {
    await auth.sso.webhook.delivery.markFailed(ctx, delivery._id, {
      attemptCount: delivery.attemptCount + 1,
      error: String(error),
    });
  }
}
```

### Disable an endpoint

```ts
await auth.sso.webhook.endpoint.disable(ctx, endpointId);
```
