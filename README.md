# @convex-dev/auth

Authentication for [Convex](https://convex.dev). Pure TypeScript, framework-agnostic, with first-class SSR support via httpOnly cookies and a proxy pattern.

Works with any framework — React, Svelte, SolidJS, TanStack Start, plain Node — no framework-specific code in the library.

## Install

```bash
npm install @convex-dev/auth
```

## Quick Setup (CLI)

```bash
npx @convex-dev/auth --site-url "http://localhost:5173"
```

The CLI will:
1. Set `SITE_URL` to your provided frontend app URL
2. Generate and set `JWT_PRIVATE_KEY` and `JWKS`
3. Update `tsconfig.json` (if needed)
4. Scaffold `convex/convex.config.ts` with component registration
5. Create `convex/auth.ts` with auth configuration
6. Create `convex/http.ts` with HTTP routes

### CLI Options

| Option | Description |
|--------|-------------|
| `--site-url <url>` | Your frontend app URL. If omitted, CLI will prompt interactively |
| `--prod` | Target production deployment |
| `--preview-name <name>` | Target a specific preview deployment |
| `--deployment-name <name>` | Target a specific deployment by name |
| `--variables <json>` | Configure additional provider variables interactively |
| `--skip-git-check` | Skip Git repository check |
| `--allow-dirty-git-state` | Allow running with uncommitted changes |

## Manual Setup

### 1. Register the auth component

`convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import auth from "@convex-dev/auth/convex.config";

const app = defineApp();
app.use(auth);

export default app;
```

### 2. Configure auth with providers

`convex/auth.ts`

```ts
import { Auth } from "@convex-dev/auth/component";
import { components } from "./_generated/api";
import password from "@convex-dev/auth/providers/password";

export const { auth, signIn, signOut, store } = Auth({
  component: components.auth,
  providers: [password],
});
```

### 3. Wire up HTTP routes

`convex/http.ts`

```ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
```

## Client API

The `client()` function creates an auth controller that works with any Convex client. It has two modes: **SPA** (direct) and **SSR proxy**.

```ts
import { client } from "@convex-dev/auth/client";
```

### SPA mode (client-side only)

Tokens are stored in `localStorage` and sent to Convex directly.

```ts
const auth = client({ convex });

auth.state;                // { isLoading, isAuthenticated, token }
auth.onChange(setState);   // subscribe to state changes, returns unsubscribe
auth.signIn("password", { email, password });
auth.signOut();
```

### SSR proxy mode (recommended for SSR frameworks)

Tokens are stored in httpOnly cookies. The client sends requests to your server proxy endpoint, which forwards them to Convex and manages cookies.

```ts
const auth = client({
  convex,
  proxy: "/api/auth",   // your server endpoint
  token: jwtFromServer, // JWT read from cookie during SSR — prevents loading flash
});
```

When `proxy` is set:
- `signIn`/`signOut`/token refresh POST to the proxy URL with `credentials: "include"`
- Token storage defaults to in-memory only (cookies handle persistence)
- OAuth code flow is handled server-side
- No `localStorage` usage, no cross-tab sync

## Server API

The `server()` function provides server-side auth helpers using standard Web `Request`/`Response` APIs. It works in any server runtime (Node, Deno, Bun, Cloudflare Workers, Nitro, etc.).

```ts
import { server } from "@convex-dev/auth/server";
```

### Creating a server instance

The `url` parameter is **required**. The library does not read environment variables — each framework has its own convention (`VITE_`, `PUBLIC_`, `NEXT_PUBLIC_`, `process.env`), so you pass the URL explicitly.

```ts
// Vite / TanStack Start
const auth = server({ url: import.meta.env.VITE_CONVEX_URL });

// Next.js
const auth = server({ url: process.env.NEXT_PUBLIC_CONVEX_URL! });

// SvelteKit
import { PUBLIC_CONVEX_URL } from "$env/static/public";
const auth = server({ url: PUBLIC_CONVEX_URL });

// Plain Node
const auth = server({ url: process.env.CONVEX_URL! });
```

### Server methods

| Method | Description |
|--------|-------------|
| `auth.token(request)` | Read JWT from httpOnly cookies. Returns `string \| null`. |
| `auth.verify(request)` | Check token expiry. Returns `Promise<boolean>`. |
| `auth.proxy(request)` | Proxy `signIn`/`signOut` to Convex, set httpOnly cookies. Returns `Promise<Response>`. |
| `auth.refresh(request)` | Handle OAuth code exchange and token refresh. Returns `Promise<RefreshResult>`. |

### Server options

```ts
type ServerOptions = {
  url: string;                    // Convex deployment URL (required)
  apiRoute?: string;              // Proxy route path (default: "/api/auth")
  cookieMaxAge?: number | null;   // Cookie max-age in seconds
  verbose?: boolean;              // Enable debug logging
};
```

## SSR Integration

The proxy pattern gives you secure, flash-free SSR auth with httpOnly cookies. Here is the flow:

### How it works

```
Page Load (SSR):
  1. Server runs beforeLoad / loader
  2. server().refresh(request) — handles OAuth code exchange + token refresh
  3. server().token(request) — reads JWT from httpOnly cookie
  4. Server returns { token } to client
  5. client({ convex, proxy, token }) — client starts authenticated, no flash

signIn / signOut:
  1. Client POSTs to /api/auth with credentials: "include"
  2. Server calls server().proxy(request) — forwards to Convex, sets httpOnly cookies
  3. Response contains { tokens: { token, refreshToken: "dummy" } }
  4. Client stores JWT in memory only (real refresh token stays in httpOnly cookie)

Token Refresh:
  1. Convex client detects token expiring, calls fetchAccessToken
  2. Client POSTs to /api/auth with { action: "auth:signIn", refreshToken: true }
  3. Server reads real refresh token from httpOnly cookie, calls Convex
  4. Server returns new JWT, sets updated cookies
```

### Example: TanStack Start

**Server proxy route** — `src/routes/api/auth.ts`

```ts
import { createFileRoute } from "@tanstack/react-router";
import { server } from "@convex-dev/auth/server";

export const Route = createFileRoute("/api/auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return server({ url: import.meta.env.VITE_CONVEX_URL! }).proxy(request);
      },
    },
  },
});
```

**SSR auth state** — `src/routes/__root.tsx`

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { server } from "@convex-dev/auth/server";

const getAuthState = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const auth = server({ url: import.meta.env.VITE_CONVEX_URL! });

  // Handle OAuth code exchange + token refresh
  const result = await auth.refresh(request);

  if (result.response) {
    // OAuth redirect — forward cookies to browser
    const cookieHeaders = result.response.headers.getSetCookie?.() ?? [];
    for (const raw of cookieHeaders) {
      setResponseHeader("set-cookie", raw);
    }
    const location = result.response.headers.get("location");
    return { token: null, redirect: location };
  }

  if (result.cookies) {
    // Token refreshed — forward updated cookies
    for (const raw of result.cookies) {
      setResponseHeader("set-cookie", raw);
    }
  }

  return { token: auth.token(request), redirect: null };
});
```

**Client hydration** — pass the token to the client for flash-free startup:

```ts
const auth = client({
  convex,
  proxy: "/api/auth",
  token: tokenFromServer,  // JWT from SSR, null if not authenticated
});
```

### Example: SvelteKit

**Server proxy route** — `src/routes/api/auth/+server.ts`

```ts
import { server } from "@convex-dev/auth/server";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

export async function POST({ request }) {
  return server({ url: PUBLIC_CONVEX_URL }).proxy(request);
}
```

**Layout server load** — `src/routes/+layout.server.ts`

```ts
import { server } from "@convex-dev/auth/server";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

export async function load({ request }) {
  const auth = server({ url: PUBLIC_CONVEX_URL });
  const result = await auth.refresh(request);
  // Forward cookies if refreshed, then:
  return { token: auth.token(request) };
}
```

### Security

All cookies are **httpOnly** — the JWT, refresh token, and OAuth verifier are never accessible to client-side JavaScript. This prevents XSS attacks from stealing tokens.

- On HTTPS: cookies use `__Host-` prefix, `Secure`, `SameSite=Lax`
- On localhost: cookies omit `__Host-` prefix and `Secure` for dev convenience
- The client never sees the real refresh token (receives `"dummy"` instead)

## Backend Usage

Use `auth.user.*` helpers in your Convex functions:

```ts
import { query } from "./_generated/server";
import { auth } from "./auth";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    return await auth.user.get(ctx, userId);
  },
});
```

### Common Helpers

| Helper | Description |
|--------|-------------|
| `auth.user.current(ctx)` | Returns signed-in user ID or `null` |
| `auth.user.require(ctx)` | Returns user ID or throws if not signed in |
| `auth.user.get(ctx, userId)` | Fetches user document by ID via component API |
| `auth.user.viewer(ctx)` | Fetches the current signed-in user document |

User profiles include an optional `extend` JSON field for app-specific data (preferences, onboarding state, feature flags, profile attributes).

### Group and membership helpers

The component exposes a hierarchical `group` primitive.

- A root group has no `parentGroupId`.
- Child groups set `parentGroupId` to another group id.
- Roles are application-defined strings on membership records (e.g. `owner`, `admin`, `member`, `viewer`).
- Groups, memberships, and invites each include an optional `extend` JSON field for custom app data.

```ts
import { mutation } from "./_generated/server";
import { auth } from "./auth";

export const createGroup = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    const groupId = await auth.group.create(ctx, {
      name: "Acme",
      extend: { billingPlan: "pro", region: "us" },
    });

    await auth.group.member.add(ctx, {
      groupId,
      userId,
      role: "owner",
      status: "active",
      extend: { invitedVia: "seed-script" },
    });

    return groupId;
  },
});
```

Main group APIs:

- `auth.group.create(ctx, data)` creates a group.
- `auth.group.get(ctx, groupId)` fetches a group.
- `auth.group.list(ctx, { parentGroupId? })` lists root groups or children.
- `auth.group.update(ctx, groupId, data)` patches a group.
- `auth.group.delete(ctx, groupId)` deletes a group and cascades to descendants, members, and invites.

Membership APIs:

- `auth.group.member.add(ctx, data)` creates membership.
- `auth.group.member.get(ctx, memberId)` fetches membership by id.
- `auth.group.member.list(ctx, { groupId })` lists members for a group.
- `auth.group.member.update(ctx, memberId, data)` updates role/status/extend.
- `auth.group.member.remove(ctx, memberId)` removes membership.
- `auth.user.group.list(ctx, { userId })` lists all memberships for a user.
- `auth.user.group.get(ctx, { userId, groupId })` fetches one membership for a user in a group.

### Invite flow

Invites are platform-level records with statuses: `pending`, `accepted`, `revoked`, `expired`.
Use optional `groupId` when an invite should grant access to a specific group.

```ts
import { mutation } from "./_generated/server";
import { auth } from "./auth";

export const inviteUser = mutation({
  args: {},
  handler: async (ctx) => {
    const invitedByUserId = await auth.user.require(ctx);
    const inviteId = await auth.invite.create(ctx, {
      groupId: "group_id_here",
      invitedByUserId,
      email: "new-user@example.com",
      tokenHash: "hashed-token",
      status: "pending",
      expiresTime: Date.now() + 1000 * 60 * 60 * 24,
      role: "member",
      extend: { source: "admin-panel" },
    });
    return inviteId;
  },
});
```

Invite APIs:

- `auth.invite.create(ctx, data)` creates an invite.
- `auth.invite.get(ctx, inviteId)` fetches an invite.
- `auth.invite.list(ctx, { groupId?, status? })` lists invites.
- `auth.invite.accept(ctx, inviteId)` accepts a pending invite.
- `auth.invite.revoke(ctx, inviteId)` revokes a pending invite.

The component does not send emails. Create invites in a mutation, then trigger notifications using your app's provider of choice (e.g. Resend).

## Environment Variables

### Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `JWT_PRIVATE_KEY` | Signs session JWTs | _(generated by CLI)_ |
| `JWKS` | JSON Web Key Set for JWT verification | _(generated by CLI)_ |
| `SITE_URL` | Frontend app URL for OAuth/magic link redirects | `http://localhost:5173` |

### System (auto-provided by Convex)

| Variable | Purpose |
|----------|---------|
| `CONVEX_SITE_URL` | Deployment's HTTP actions URL. Used as JWT issuer and OAuth callback base. |

### Provider Variables

| Variable Pattern | Example | Purpose |
|-----------------|---------|---------|
| `AUTH_<PROVIDER>_ID` | `AUTH_GITHUB_ID` | OAuth client ID |
| `AUTH_<PROVIDER>_SECRET` | `AUTH_GITHUB_SECRET` | OAuth client secret |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTH_SESSION_TOTAL_DURATION_MS` | Max session lifetime (ms) | 30 days |
| `AUTH_SESSION_INACTIVE_DURATION_MS` | Inactive session timeout (ms) | _(provider-specific)_ |
| `AUTH_LOG_LEVEL` | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` | `INFO` |

## Providers

All providers use lowercase names with default exports:

```ts
import password from "@convex-dev/auth/providers/password";
import anonymous from "@convex-dev/auth/providers/anonymous";
import credentials from "@convex-dev/auth/providers/credentials";
import email from "@convex-dev/auth/providers/email";
import phone from "@convex-dev/auth/providers/phone";
```

## Component System

Auth runs through a component API boundary (`component: components.auth`). All auth tables live inside the component — you don't modify your schema.

## Full Documentation

For complete documentation, see: https://deepwiki.com/robelest/convex-auth

## Roadmap

### Phase 1 — Complete Core Auth
- **Two-Factor Authentication (2FA)**: TOTP authenticator app support, backup codes, trusted devices
- **Passkeys / WebAuthn**: Passwordless authentication via biometrics and security keys (powered by SimpleWebAuthn)
- **Admin Operations**: User ban/unban, session listing and revocation, user impersonation
- **Account Deletion**: Full cascade across sessions, tokens, accounts, memberships, and invites

### Phase 2 — Developer Platform
- **API Keys**: Hashed key storage, CRUD, per-key rate limiting, scoped permissions, `x-api-key` header verification
- **One-Time Tokens**: Secure single-use tokens for cross-domain auth, magic actions, and email verification links
- **Device Authorization (RFC 8628)**: OAuth device flow for CLIs, smart TVs, and IoT devices
- **Bearer Token Auth**: `Authorization: Bearer` header support for API-first applications

### Phase 3 — OAuth Foundation
- **Migrate to Arctic**: Replace `@auth/core` with Arctic for a lighter, actively maintained OAuth 2.0 client layer with zero third-party dependencies

### Phase 4 — Enterprise SSO & Directory Sync
- **SSO (SAML 2.0 + OIDC)**: Register identity providers dynamically, sign in by domain/email/org, SAML assertion validation, OIDC discovery, attribute mapping (powered by samlify)
- **SCIM 2.0 Directory Sync**: User lifecycle management — provision, update, and deprovision users from Okta, Azure AD, Google Workspace, and other directory providers. Standard + custom attribute mapping, group sync, and provisioning/deprovisioning events
- **Domain Verification**: DNS TXT record verification for organization domain ownership
- **Organization Provisioning**: Auto-add SSO/SCIM users to groups with role mapping
- **Self-Serve Admin Portal** (`@robelest/convex-auth-portal`): Astro-powered UI served directly from Convex HTTP endpoints. IT admins configure SSO, SCIM, and domain verification through a guided wizard — no developer involvement needed. Generate a secure link, send it to your customer's IT team. Includes per-IdP setup guides for Okta, Azure AD, Google Workspace, OneLogin, JumpCloud, and custom SAML/OIDC. Supports branding customization (logo, colors, app name)

### Phase 5 — Be the Identity Provider
- **OAuth 2.1 Provider**: Authorization code flow with PKCE, client credentials, refresh tokens, dynamic client registration, token introspection and revocation
- **OIDC Provider**: id_token issuance, UserInfo endpoint, `.well-known/openid-configuration`
- **MCP Support**: Model Context Protocol authentication for AI agent integrations

### Phase 6 — Enterprise Hardening
- **Audit Logging**: Structured auth event log (sign-in, sign-out, password change, 2FA enable, admin actions) with actor/target/context tracking
- **Webhook Notifications**: Fire webhooks on auth lifecycle events (user created, session created, password changed, user provisioned via SCIM)
- **Advanced Rate Limiting**: IP-based brute force protection
- **OAuth Token Storage**: Store provider access/refresh tokens for apps that call provider APIs on behalf of users

---

## Contributing

### Install Dependencies

```bash
bun install
```

### Start Convex Dev

```bash
bun run dev:convex
```

### Run Tests

```bash
bun run test:auth
```

### Monorepo Structure

- `packages/auth/` — Main auth package
- `packages/portal/` — Self-serve admin portal (Astro)
- `packages/test/` — Shared test suite
- `examples/tanstack/` — TanStack Start example app
- `convex/` — Root Convex functions for testing
