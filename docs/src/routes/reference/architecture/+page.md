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

Your app registers the auth component and wires three files:

<CardGrid>
  <Card title="convex.config.ts">
    <code>app.use(auth)</code> — registers the auth component with your Convex app.
  </Card>
  <Card title="auth.ts">
    <code>createAuth(components.auth, {'{'}providers{'}'})</code> — configures providers and
    returns the <code>auth</code> helper object.
  </Card>
  <Card title="http.ts">
    <code>auth.http.add(http)</code> — registers OAuth callbacks, JWKS, and SSO protocol
    routes.
  </Card>
</CardGrid>

The component owns its own isolated tables:

| Table        | Purpose                                      |
| ------------ | -------------------------------------------- |
| `User`       | User records                                 |
| `Account`    | Linked auth accounts (OAuth, password, etc.) |
| `Session`    | Active sessions                              |
| `Group`      | Organizations / teams                        |
| `Member`     | Group memberships with roles                 |
| `Invite`     | Pending invitations                          |
| `ApiKey`     | API keys with scopes                         |
| `Passkey`    | WebAuthn credentials                         |
| `Totp`       | TOTP enrollments                             |
| `Enterprise` | SSO connections (OIDC/SAML/SCIM config)      |

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
  `{ subject: "userId|sessionId" }`
- `auth.ctx()` / `auth.context(ctx)` resolves `{ userId, user, groupId, role, grants }`

## Key design constraints

- Component functions are **always internal** from the parent's perspective.
  Your app re-exports the public auth actions it wants to expose.
- Components cannot access `ctx.auth` or `process.env`. Auth checks and env var
  reads happen at the app layer.
- Component tables are isolated — they don't share the app's data model.

## What `createAuth` returns

`createAuth(components.auth, config)` returns an object with:

- **Actions**: `signIn`, `signOut`, `store` — the client-facing auth flow
- **Helpers**: `auth.user.*`, `auth.session.*`, `auth.group.*`, etc. —
  server-side primitives
- **HTTP**: `auth.http.add(http)` — registers OAuth callbacks and JWKS
- **SSO** (conditional): `auth.sso.*` — only present when `new SSO()` is in
  providers
- **SCIM** (conditional): `auth.scim.admin.*` — provisioning helpers when
  `new SSO()` is in providers

## Where `ctx.auth` comes from

`createAuth(...)` does not mutate every Convex handler automatically. App code
typically wires `auth.ctx()` into custom builders once, then uses those builders
everywhere auth is required.

```ts
// convex/functions.ts
import {
  customAction,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { action, mutation, query } from "./_generated/server";
import { auth } from "./auth";

export const authQuery = customQuery(query, auth.ctx());
export const authMutation = customMutation(mutation, auth.ctx());
export const authAction = customAction(action, auth.ctx());
```

Inside those handlers, `ctx.auth` includes `{ userId, user, groupId, role,
grants }` and unauthenticated callers are rejected before your handler runs.

## API layers

| Layer                  | What it is                                                        | Typical usage                                                               |
| ---------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Auth-flow actions      | Required client-callable functions exported from `convex/auth.ts` | `api.auth.signIn`, `api.auth.signOut`, `api.auth.store`                     |
| Helper namespaces      | Server-side helper APIs returned by `createAuth(...)`             | `auth.member.require(ctx, ...)`, `auth.sso.admin.connection.create(ctx, ...)` |
| Mounted enterprise RPC | Optional app-owned public RPC for enterprise/admin UI             | `api.auth.enterprise.createConnection`, `api.auth.enterprise.configureScim` |

Only the first layer is required for the frontend auth client. The third layer
exists only if your app explicitly exposes app-owned enterprise wrappers or
custom enterprise wrappers. For the app-facing RPC surface, see the
[Enterprise RPC guide](/sso/rpc/).

`auth.oauth.*` is the planned provider-mode namespace and is intentionally not
part of the current stable surface yet.

## Multi-access model

Every auth path resolves to the same `userId`:

| Access pattern                     | How `userId` is available                            |
| ---------------------------------- | ---------------------------------------------------- |
| Browser (password, OAuth, passkey) | `ctx.auth.userId` via `auth.ctx()`                   |
| Enterprise SSO (OIDC / SAML)       | Same as browser - SSO completes as a session         |
| Device flow (CLI / IoT)            | Same as browser - device poll returns session tokens |
| API key (machine / automation)     | `ctx.key.userId` or `auth.user.id(ctx, request)`     |

The `userId` is the single shared anchor — server logic works regardless of how
the caller authenticated. In app code, prefer `auth.ctx()` and `ctx.auth.userId`.
Keep `auth.user.id(ctx, request?)` for advanced raw HTTP handlers.
