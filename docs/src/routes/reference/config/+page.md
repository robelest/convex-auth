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
import { v } from "convex/values";

const auth = createAuth(components.auth, {
  providers: [
    /* ... */
  ],
  // All options below are optional
  // Type the `extend` field of each table. Drives both the inferred
  // type of `auth.v.*` and runtime validation of return shapes.
  extend: {
    User: v.object({ stripeCustomerId: v.optional(v.string()) }),
  },
  session: {
    totalDurationMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    inactiveDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  jwt: {
    durationMs: 60 * 1000, // 1 minute
  },
  signIn: {
    maxFailedAttemptsPerHour: 10,
  },
  callbacks: {
    async after(ctx, event) {
      if (event.kind === "userCreated") {
        // post-signup work, e.g. trigger an onboarding workflow
      }
      if (event.kind === "passwordChanged") {
        // audit log, security email, etc.
      }
    },
    async before(ctx, event) {
      if (event.kind === "redirect") {
        return safeRedirect(event.redirectTo);
      }
      // returning undefined falls back to the default behavior
    },
  },
  authorization: {
    roles: {
      member: {
        label: "Member",
        grants: [],
      },
    },
  },
});
```

## Config options

| Option                                | Type                   | Default  | Description                             |
| ------------------------------------- | ---------------------- | -------- | --------------------------------------- |
| `providers`                           | `AuthProviderConfig[]` | required | Auth methods to enable                  |
| `extend`                              | `{ User?, Group?, GroupMember? }` Convex validators | `{}` | Validator for each table's `extend` field. Types `auth.v.*` (so `viewer.extend.<field>` is typed) and validates return shapes. |
| `session.totalDurationMs`             | `number`               | 30 days  | Maximum session lifetime                |
| `session.inactiveDurationMs`          | `number`               | varies   | Inactive session timeout                |
| `jwt.durationMs`                      | `number`               | 60s      | JWT token lifetime                      |
| `signIn.maxFailedAttemptsPerHour`     | `number`               | 10       | Rate limit for failed sign-in attempts  |
| `callbacks.before`                    | `function`             | —        | Intercept `redirect` / `link`. Return `undefined` for default. |
| `callbacks.after`                     | `function`             | —        | Notification for lifecycle events: `userCreated`, `signedIn`, `passwordChanged`, `passkeyAdded`, `totpEnrolled`, `emailVerified`, `phoneVerified`, `accountLinked`, `signedOut`, `sessionsInvalidated`, `userUpdated`. |
| `authorization.roles`                 | `Record<string, Role>` | `{}`     | App-defined role definitions and grants |

> **Note:** Email transport is configured via `email({ from, send })` in the
> providers array, not as a top-level config option.

See [Authorization Patterns](/guides/authorization) for the recommended
authorization model.

## Return value

`createAuth` returns an object with:

- `signIn` — Action for client sign-in
- `signOut` — Action for client sign-out
- `store` — Internal runtime mutation for session token exchange
- `auth.user.*` — User helpers
- `auth.session.*` — Session helpers
- `auth.account.*` — Account helpers
- `auth.group.*` — Group helpers
- `auth.member.*` — Membership helpers
- `auth.invite.*` — Invite helpers
- `auth.key.*` — API key helpers
- `auth.request.*` — HTTP route helpers
- `auth.v.*` — Convex `returns:` validators for the read surface
  (`user`, `group`, `member`, `invite`, `viewer`, `list`). See
  [Typed Returns](/reference/typed-returns).
- `auth.group.sso.*` — inbound group SSO helpers (only when `sso()` is in
  providers)
- `auth.group.sso.scim.*` — SCIM provisioning helpers (only when `sso()` is in
  providers)
- `InferClientApi<typeof auth>` — Type-level utility; use as the generic for
  `client()` on the frontend to get conditional passkey/totp/device helpers
- `Doc`, `Viewer`, `Group`, `Membership` — exported document types
  (extend-aware), importable from `@robelest/convex-auth/server`

## API layers

<CardGrid>
  <Card title="Auth-flow actions">
    <code>signIn</code> and <code>signOut</code> are the app-facing Convex functions used by the frontend auth
    client.
  </Card>
  <Card title="Helper namespaces">
    <code>auth.*</code>, <code>auth.group.sso.*</code>, and <code>auth.group.sso.scim.*</code> are server-side helper APIs for
    your Convex code.
  </Card>
  <Card title="Mounted group SSO RPC">
    <code>api.auth.group.*</code> only exists after your app mounts or
    writes public group SSO wrappers.
  </Card>
</CardGrid>

The `auth.group.sso.*` and `auth.group.sso.scim.*` namespaces are server-side
helper APIs. They are not automatically exposed as client-callable Convex
functions just because they exist on the returned object.

If your app wants public group SSO admin RPC, mount it explicitly in your app:

- write your own Convex wrappers in a file such as `convex/auth/group.ts`.

See the [Group SSO RPC guide](/sso/rpc/) for the recommended flat group SSO RPC
shape.
