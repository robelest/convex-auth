---
title: Architecture
description: How convex-auth works as a Convex component.
---

<script>
  import Card from '$lib/components/docs/Card.svelte';
  import CardGrid from '$lib/components/docs/CardGrid.svelte';
</script>

<svelte:head>

  <title>Architecture - convex-auth</title>
</svelte:head>

# Architecture

## Component model

Your app registers the auth component and wires four files:

<CardGrid>
  <Card title="convex.config.ts">
    <code>app.use(auth)</code> — registers the auth component and its isolated
    storage/functions.
  </Card>
  <Card title="auth.ts">
    <code>createAuth(components.auth, {'{'}providers{'}'})</code> — configures providers and
    exports <code>signIn</code>, <code>signOut</code>, <code>store</code>, and <code>http</code>.
  </Card>
  <Card title="auth/core.ts">
    <code>createAuthContext(components.auth)</code> — lightweight auth context for
    queries and mutations. No providers or crypto loaded.
  </Card>
  <Card title="HTTP alias">
    <code>auth.http()</code> — mounts OAuth callbacks,
    JWKS, and SSO protocol routes from the app-side alias.
  </Card>
</CardGrid>

The component owns its own isolated tables:

| Table              | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `User`             | User records                                 |
| `Account`          | Linked auth accounts (OAuth, password, etc.) |
| `Session`          | Active sessions                              |
| `Group`            | Organizations / teams                        |
| `Member`           | Group memberships with roles                 |
| `Invite`           | Pending invitations                          |
| `ApiKey`           | API keys with scopes                         |
| `Passkey`          | WebAuthn credentials                         |
| `Totp`             | TOTP enrollments                             |
| `Group Connection` | SSO connections (OIDC/SAML/SCIM config)      |

The auth component also installs three Convex subcomponents internally:

| Subcomponent                  | Role                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `@convex-dev/migrations`      | Versioned data migrations against the component's own tables         |
| `@convex-dev/rate-limiter`    | Sign-in throttle (token-bucket; backs `auth.signIn` rate limiting)   |
| `@convex-dev/workpool`        | Webhook delivery worker — drives retries with exponential backoff    |

These are mounted by `component.use(...)` inside `convex.config.ts`; the
parent app doesn't install or configure them.

## Function visibility

Every function exposed by the auth component is registered as
`internalQuery` / `internalMutation` / `internalAction`. Clients of the
parent app cannot reach component functions directly — all access goes
through `ctx.runQuery` / `ctx.runMutation` from server-side wrappers (the
`auth.*` helpers documented under API Reference).

## Scheduled cleanup

The component owns its own `crons.ts` and runs a daily `pruneExpired`
job (03:00 UTC) that prunes expired rows from `Session`, `RefreshToken`,
`VerificationCode`, `AuthVerifier`, `GroupInvite`, and `DeviceCode`.
Batched at 200 docs per run by default; rerun the cron tomorrow to drain
any backlog.

## Auth flow

1. **Client** calls `signIn(provider, params)`
2. **App** stores a verification code in the component and returns a redirect
   URL
3. **Client** redirects to the OAuth / SSO provider
4. **Provider** authenticates the user and redirects back with a code
5. **App** calls the component to verify the code and upsert the user
6. **Component** returns session tokens (JWT + refresh token)
7. **Client** stores tokens — subsequent requests include the JWT

For subsequent requests:

- Queries/mutations call `ctx.auth.getUserIdentity()` which returns
  `{ subject: "userId", sid: "sessionId", email?, name?, picture? }`
- `auth.ctx()` / `auth.context(ctx)` resolves
  `{ userId, user, groupId, role, grants }`

## Key design constraints

- Component functions are **always internal** from the parent's perspective.
  Your app re-exports the public auth actions it wants to expose.
- Components cannot access `ctx.auth` or `process.env`. Auth checks and env var
  reads happen at the app layer.
- Component tables are isolated — they don't share the app's data model.

## What `createAuth` returns

`createAuth(components.auth, config)` returns an object with:

- **Actions**: `signIn`, `signOut` — the client-facing auth flow
- **Internal runtime**: `store` — session token exchange used internally by the auth runtime
- **Helpers**: `auth.user.*`, `auth.session.*`, `auth.group.*`, etc. —
  server-side primitives
- **Request helpers**: `auth.request.context`, `auth.request.action`, and `auth.request.route` for your own app routes
- **SSO** (conditional): `auth.group.sso.*` — only present when `sso()` is in
  providers
- **SCIM** (conditional): `auth.group.sso.scim.*` — provisioning helpers when
  `sso()` is in providers

## Entry point split: `server` vs `core`

`createAuth` from `@robelest/convex-auth/server` loads provider implementations,
OAuth, crypto, and HTTP route handling. Queries and mutations never use any of
that. To keep your function bundles fast, use the split pattern:

```ts
// convex/auth.ts — heavyweight, only evaluated for signIn/signOut
import { createAuth } from "@robelest/convex-auth/server";
import { google, password } from "@robelest/convex-auth/providers";

export const { signIn, signOut, store } = createAuth(components.auth, {
  providers: [google({ clientId, clientSecret }), password()],
});
```

```ts
// convex/auth.config.ts — native Convex JWT trust
export default {
  providers: [
    {
      domain: `${process.env.CONVEX_SITE_URL}/auth`,
      applicationID: "convex",
    },
  ],
};
```

```ts
// convex/auth/core.ts — lightweight, imported by all queries
import { createAuthContext } from "@robelest/convex-auth/core";
import { components } from "../_generated/api";

export const auth = createAuthContext(components.auth, {
  authorization: { roles },
});
```

```ts
// convex/functions.ts
import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
import { query, mutation } from "./_generated/server";
import { auth } from "./auth/core";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
```

`createAuthContext` returns the same `user`, `session`, `member`, `group`,
`account`, `invite`, `key`, `context`, and `ctx` APIs as `createAuth` — but
without `signIn`, `signOut`, `store`, `http`, or provider logic. Queries that
import from `auth/core.ts` never load provider, OAuth, or crypto code.

| Entry point                         | What it loads                               | Use for                                         |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `@robelest/convex-auth/server`      | Everything (providers, OAuth, crypto, HTTP) | `convex/auth.ts` — signIn/signOut exports       |
| `@robelest/convex-auth/core`        | Context resolution only (~2KB)              | `convex/functions.ts` — query/mutation wrappers |
| `@robelest/convex-auth/browser`     | Browser client defaults                     | Web apps and SSR client hydration               |
| `@robelest/convex-auth/react`       | React `useAuth()` + `ConvexAuthProvider`    | React apps wrapping the browser client          |
| `@robelest/convex-auth/expo`        | Expo SecureStore, AuthSession, passkeys     | Expo / React Native apps                        |
| `@robelest/convex-auth/providers/*` | Individual provider                         | Only in `convex/auth.ts`                        |

Your app also needs `convex/auth.config.ts` so Convex trusts the JWT issuer
used by Convex Auth.

## Where `ctx.auth` comes from

Neither `createAuth` nor `createAuthContext` mutate every Convex handler
automatically. App code wires `auth.ctx()` into custom builders once, then uses
those builders everywhere auth is required.

```ts
// convex/functions.ts
import { customAction, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { action, mutation, query } from "./_generated/server";
import { auth } from "./auth/core";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
export const authAction = customAction(action, auth.ctx());
```

Inside those handlers, `ctx.auth` includes
`{ userId, user, groupId, role, grants }` and unauthenticated callers are
rejected before your handler runs.

## API layers

| Layer                 | What it is                                                        | Typical usage                                                                 |
| --------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Auth-flow actions     | Required client-callable functions exported from `convex/auth.ts` | `api.auth.signIn`, `api.auth.signOut`                                         |
| Internal auth action  | Internal runtime mutation exported from `convex/auth.ts`          | `internal.auth.store`                                                         |
| Helper namespaces     | Server-side helper APIs returned by `createAuth(...)`             | `auth.member.require(ctx, ...)`, `auth.group.sso.connection.create(ctx, ...)` |
| Mounted group SSO RPC | Optional app-owned public RPC for group SSO admin UI              | `api.auth.group.createConnection`, `api.auth.group.configureScim`             |

Only the first layer is required for the frontend auth client. The third layer
exists only if your app explicitly exposes app-owned group SSO wrappers or
custom group SSO wrappers. For the app-facing RPC surface, see the
[Group SSO RPC guide](/sso/rpc/).

`auth.oauth.*` is the planned provider-mode namespace and is intentionally not
part of the current stable surface yet.

## Multi-access model

Every auth path resolves to the same `userId`:

| Access pattern                     | How `userId` is available                                       |
| ---------------------------------- | --------------------------------------------------------------- |
| Browser (password, OAuth, passkey) | `ctx.auth.userId` via `auth.ctx()`                              |
| Group SSO (OIDC / SAML)            | Same as browser - SSO completes as a session                    |
| Device flow (CLI / IoT)            | Same as browser - device poll returns session tokens            |
| API key (machine / automation)     | `ctx.key.userId` or `auth.request.context(ctx, request).userId` |

The `userId` is the single shared anchor — server logic works regardless of how
the caller authenticated. In app code, prefer `auth.ctx()` and
`ctx.auth.userId`. Use `auth.request.context(ctx, request)` for advanced raw HTTP
handlers that accept either a session or an API key.
