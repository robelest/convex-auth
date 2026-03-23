---
title: Configuration
description: createAuth options reference.
---

<script>
  import Card from '$lib/components/docs/Card.svelte';
  import CardGrid from '$lib/components/docs/CardGrid.svelte';
</script>

<svelte:head>

  <title>Configuration - convex-auth</title>
</svelte:head>

# Configuration

## `createAuth(component, config)`

```ts
import { createAuth } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";

const auth = createAuth(components.auth, {
  providers: [
    /* ... */
  ],
  // All options below are optional
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    inactiveDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  jwt: {
    durationMs: 60 * 1000, // 1 minute
  },
  signIn: {
    max_failed_attempts_per_hour: 10,
  },
  callbacks: {
    afterUserCreatedOrUpdated: async (ctx, { userId, existingUser }) => {
      /* ... */
    },
  },
});
```

## Config options

| Option                                | Type                   | Default  | Description                            |
| ------------------------------------- | ---------------------- | -------- | -------------------------------------- |
| `providers`                           | `AuthProviderConfig[]` | required | Auth methods to enable                 |
| `session.totalDurationMs`             | `number`               | 30 days  | Maximum session lifetime               |
| `session.inactiveDurationMs`          | `number`               | varies   | Inactive session timeout               |
| `jwt.durationMs`                      | `number`               | 60s      | JWT token lifetime                     |
| `signIn.max_failed_attempts_per_hour` | `number`               | 10       | Rate limit for failed sign-in attempts |
| `callbacks.afterUserCreatedOrUpdated` | `function`             | —        | Post-sign-in hook                      |

> **Note:** Email transport is configured via `new Email({ from, send })` in the
> providers array, not as a top-level config option.

## Return value

`createAuth` returns an object with:

- `signIn` — Action for client sign-in
- `signOut` — Action for client sign-out
- `store` — Mutation for session token exchange
- `auth.user.*` — User helpers
- `auth.session.*` — Session helpers
- `auth.account.*` — Account helpers
- `auth.group.*` — Group helpers
- `auth.member.*` — Membership helpers
- `auth.invite.*` — Invite helpers
- `auth.key.*` — API key helpers
- `auth.http.*` — HTTP route helpers
- `auth.sso.*` — inbound enterprise SSO helpers (only when `new SSO()` is in
  providers)
- `auth.scim.*` — SCIM provisioning helpers (only when `new SSO()` is in
  providers)
- `InferClientApi<typeof auth>` — Type-level utility; use as the generic for
  `client()` on the frontend to get conditional passkey/totp/device helpers

## API layers

<CardGrid>
  <Card title="Auth-flow actions">
    <code>signIn</code>, <code>signOut</code>, and <code>store</code> are the app-facing Convex functions used by
    the frontend auth client.
  </Card>
  <Card title="Helper namespaces">
    <code>auth.*</code>, <code>auth.sso.*</code>, and <code>auth.scim.*</code> are server-side helper APIs for
    your Convex code.
  </Card>
  <Card title="Mounted enterprise RPC">
    <code>api.auth.sso.*</code> and <code>api.auth.scim.*</code> only exist after your app mounts or
    writes public enterprise wrappers.
  </Card>
</CardGrid>

The `auth.sso.*` and `auth.scim.*` namespaces are server-side helper APIs. They
are not automatically exposed as client-callable Convex functions just because
they exist on the returned object.

If your app wants public enterprise/admin RPC, mount it explicitly in your app:

- write your own Convex wrappers, or
- run `convex-auth mount enterprise` to scaffold nested `convex/auth/sso/**` and
  `convex/auth/scim/**` files.
