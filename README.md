# @robelest/convex-auth

Component-first authentication for [Convex](https://convex.dev). One component, one class, full TypeScript support.

- **Class-based API** — `new Auth(components.auth, { providers })` gives you everything: auth, portal, helpers.
- **Built-in admin portal** — A dark-themed SvelteKit dashboard served directly from your Convex deployment. Manage users, sessions, and invites. No separate hosting.
- **Self-hosting as a sub-component** — Portal static files are stored and served through an embedded `@convex-dev/self-hosting` sub-component. You install one component, not two.
- **Groups, memberships, invites** — Hierarchical groups with roles, atomic invite acceptance, and cascade deletes.
- **Passkeys, TOTP, password, OAuth, magic links, OTP, phone, anonymous** — All built in.

## Install

```bash
npm install @robelest/convex-auth
```

## Quick Setup (CLI)

```bash
npx @robelest/convex-auth
```

The interactive setup wizard runs 6 steps:

1. **Configure `SITE_URL`** — auto-detects your framework (Vite `:5173`, Next.js `:3000`, etc.)
2. **Generate key pair** — creates RS256 `JWT_PRIVATE_KEY` and `JWKS`, sets them on your deployment
3. **Configure `tsconfig.json`** — sets `moduleResolution: "Bundler"` and `skipLibCheck: true`
4. **Create `convex/convex.config.ts`** — registers the auth component with `app.use(auth)`
5. **Create `convex/auth.ts`** — scaffolds `new Auth(components.auth, { providers })` with `Portal()` exports
6. **Create `convex/http.ts`** — wires up `auth.addHttpRoutes(http)` for OAuth callbacks, JWKS, and portal serving

Pass `--site-url` to skip the URL prompt:

```bash
npx @robelest/convex-auth --site-url "http://localhost:5173"
```

## Manual Setup

Three files. That's it.

### 1. Register the component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import auth from "@robelest/convex-auth/convex.config";

const app = defineApp();
app.use(auth);

export default app;
```

### 2. Configure auth

```ts
// convex/auth.ts
import { Auth, Portal } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";
import github from "@auth/core/providers/github";

const auth = new Auth(components.auth, {
  providers: [github],
});

export { auth };
export const { signIn, signOut, store } = auth;
export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
```

`Auth` wraps auth actions and helper accessors. `Portal()` creates the portal admin function definitions — a separate call because Convex's bundler needs plain function returns to recognize exported function definitions.

### 3. Wire up HTTP routes

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
```

`addHttpRoutes` registers OAuth callbacks, JWKS endpoints, and portal static file serving in one call.

## Backend Usage

Use `auth.*` helpers directly in your Convex functions:

```ts
import { query, mutation } from "./_generated/server";
import { auth } from "./auth";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    return await auth.user.get(ctx, userId);
  },
});

export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await auth.user.require(ctx);
    // ... your logic
  },
});
```

### Auth helpers

| Helper | Returns |
|--------|---------|
| `auth.user.current(ctx)` | User ID or `null` |
| `auth.user.require(ctx)` | User ID (throws if not signed in) |
| `auth.user.get(ctx, userId)` | User document |
| `auth.user.viewer(ctx)` | Current user's document |

### Groups and memberships

Hierarchical groups with application-defined roles. Groups, memberships, and invites each have an optional `extend` JSON field for app-specific data.

```ts
const groupId = await auth.group.create(ctx, {
  name: "Acme Corp",
  extend: { billingPlan: "pro" },
});

await auth.group.member.add(ctx, {
  groupId,
  userId,
  role: "owner",
  status: "active",
});
```

| API | Description |
|-----|-------------|
| `auth.group.create(ctx, data)` | Create a group |
| `auth.group.get(ctx, groupId)` | Get a group |
| `auth.group.list(ctx, { parentGroupId? })` | List root or child groups |
| `auth.group.update(ctx, groupId, data)` | Update a group |
| `auth.group.delete(ctx, groupId)` | Delete group + cascade members/invites |
| `auth.group.member.add(ctx, data)` | Add membership |
| `auth.group.member.list(ctx, { groupId })` | List members |
| `auth.group.member.update(ctx, memberId, data)` | Update role/status |
| `auth.group.member.remove(ctx, memberId)` | Remove membership |
| `auth.user.group.list(ctx, { userId })` | List user's memberships |
| `auth.user.group.get(ctx, { userId, groupId })` | Get user's membership in a group |

### Invites

Platform-level invite records with statuses: `pending`, `accepted`, `revoked`, `expired`.

```ts
const inviteId = await auth.invite.create(ctx, {
  groupId,
  invitedByUserId: userId,
  email: "new@example.com",
  tokenHash: "hashed-token",
  status: "pending",
  expiresTime: Date.now() + 86_400_000,
  role: "member",
});
```

Atomic accept + membership creation in a single mutation:

```ts
await auth.invite.accept(ctx, inviteId);
if (invite.groupId) {
  await auth.group.member.add(ctx, {
    groupId: invite.groupId,
    userId,
    role: invite.role,
  });
}
```

| API | Description |
|-----|-------------|
| `auth.invite.create(ctx, data)` | Create an invite |
| `auth.invite.get(ctx, inviteId)` | Get an invite |
| `auth.invite.list(ctx, { groupId?, status? })` | List invites |
| `auth.invite.accept(ctx, inviteId)` | Accept (pending only) |
| `auth.invite.revoke(ctx, inviteId)` | Revoke (pending only) |

Error codes: `DUPLICATE_MEMBERSHIP`, `DUPLICATE_INVITE`, `INVITE_NOT_FOUND`, `INVITE_NOT_PENDING`.

### API Keys

Programmatic access with scoped permissions, SHA-256 hashed storage, and optional per-key rate limiting.

```ts
// Create a key
const { keyId, raw } = await auth.key.create(ctx, {
  userId,
  name: "CI Pipeline",
  scopes: [{ resource: "users", actions: ["read", "list"] }],
});
// raw = "cvx_abc123..." — show once, never stored

// Verify a key from a request
const key = await auth.key.verify(ctx, bearerToken);
// key = { userId, scopes, ... } or null
```

| API | Description |
|-----|-------------|
| `auth.key.create(ctx, data)` | Create a key (returns raw key + ID) |
| `auth.key.verify(ctx, rawKey)` | Verify and return key record (or null) |
| `auth.key.list(ctx)` | List all keys |
| `auth.key.get(ctx, keyId)` | Get a key by ID |
| `auth.key.update(ctx, keyId, data)` | Update name, scopes, rate limit |
| `auth.key.revoke(ctx, keyId)` | Revoke a key (soft delete) |
| `auth.key.remove(ctx, keyId)` | Permanently delete a key |

Keys support wildcard scopes (`{ resource: "*", actions: ["*"] }`) and optional token-bucket rate limiting via `rateLimit: { maxTokens, refillRate }`.

## Admin Portal

A dark-themed SvelteKit admin dashboard for managing users, sessions, and API keys. Available in two modes: **hosted CDN** (zero setup) and **self-hosted** (served from your Convex deployment).

The portal lets you:
- View and search all users
- Inspect user details, accounts, and sessions
- Revoke active sessions
- Create and manage API keys
- Control admin access via invite links

### Option A: Hosted CDN (recommended)

The portal is hosted at `auth.robelest.com` and connects to any Convex deployment via the deployment slug in the URL. No upload, no build, no hosting.

**1. Generate an admin invite link:**

```bash
npx @robelest/convex-auth portal link
```

**2. Open the link** — sign in with your email (magic link), and you're an admin.

The portal is immediately available at:

```
https://auth.robelest.com/<your-deployment-slug>
```

For example, if your Convex URL is `https://rapid-cat-62.convex.cloud`, the portal lives at `https://auth.robelest.com/rapid-cat-62`. Sub-pages use clean paths: `/rapid-cat-62/users`, `/rapid-cat-62/sessions`, `/rapid-cat-62/keys`.

### Option B: Self-Hosted

Portal static files are stored in Convex via the `@convex-dev/self-hosting` sub-component and served from your own deployment at `https://<deployment>.convex.site/auth`.

**1. Upload the portal:**

```bash
npx @robelest/convex-auth portal upload
```

**2. Generate an admin invite link:**

```bash
npx @robelest/convex-auth portal link
```

**3. Open the link** — the portal is live at `https://<your-deployment>.convex.site/auth`.

### How it works

**Self-hosted mode:**
- `addHttpRoutes` registers a `GET /auth/.well-known/portal-config` endpoint that returns the Convex URL, site URL, and version. The SPA fetches this on boot to discover its backend.
- Static files (HTML, JS, CSS) are served from Convex storage with SPA fallback at `/auth/*`.
- The SvelteKit build uses `base: "/auth"` so all routes nest under the `/auth` prefix.

**CDN mode:**
- The same SvelteKit app is built with `base: ""` (root) and deployed to Cloudflare Pages at `auth.robelest.com`.
- The first path segment is the deployment slug (e.g. `/rapid-cat-62`). A SvelteKit `reroute` hook strips the slug before route matching, so `/rapid-cat-62/users` renders the `/users` route while keeping the full path in the address bar.
- No config endpoint is needed — the slug directly encodes the Convex cloud URL (`https://{slug}.convex.cloud`).

**Shared architecture:**
- The portal uses a `portal` email provider (auto-registered by `Auth`) for magic link sign-in.
- Admin access is controlled by invite records with `role: "portalAdmin"`. The first admin is created via `portal link`.
- All portal data flows through `portalQuery`, `portalMutation`, and `portalInternal` — exported from your `convex/auth.ts`. The portal client calls these, not component internals directly.

## Providers

### OAuth

Any `@auth/core` provider works:

```ts
import github from "@auth/core/providers/github";
import google from "@auth/core/providers/google";

new Auth(components.auth, {
  providers: [github, google],
});
```

Set `AUTH_<PROVIDER>_ID` and `AUTH_<PROVIDER>_SECRET` on your deployment.

### Magic Links (Email)

Configure `email` on the `Auth` constructor to enable magic link sign-in. The library auto-registers two providers: `"email"` (user-facing) and `"portal"` (portal admin sign-in).

```ts
import { Resend } from "resend";

const auth = new Auth(components.auth, {
  providers: [github],
  email: {
    from: "My App <noreply@example.com>",
    send: async (ctx, { from, to, subject, html }) => {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({ from, to, subject, html });
    },
  },
});
```

Works with any email provider (Resend, SendGrid, SES, Postmark, etc.). The `ctx` parameter is a Convex `ActionCtx` so you can access environment variables and the database.

### Password

```ts
import password from "@robelest/convex-auth/providers/password";

new Auth(components.auth, {
  providers: [password],
});
```

### Passkeys / WebAuthn

```ts
import passkey from "@robelest/convex-auth/providers/passkey";

new Auth(components.auth, {
  providers: [passkey],
});
```

### TOTP (authenticator apps)

```ts
import totp from "@robelest/convex-auth/providers/totp";

new Auth(components.auth, {
  providers: [totp({ issuer: "My App" })],
});
```

### Phone / SMS

```ts
import phone from "@robelest/convex-auth/providers/phone";

const sms = phone({
  id: "twilio",
  async sendVerificationRequest({ identifier, token }) {
    // send SMS via Twilio, etc.
  },
});
```

### Anonymous

```ts
import anonymous from "@robelest/convex-auth/providers/anonymous";

new Auth(components.auth, {
  providers: [anonymous],
});
```

## Environment Variables

### Required

| Variable | Purpose |
|----------|---------|
| `JWT_PRIVATE_KEY` | Signs session JWTs |
| `JWKS` | JSON Web Key Set for verification |
| `SITE_URL` | Frontend URL for OAuth/magic link redirects |

### System (auto-provided by Convex)

| Variable | Purpose |
|----------|---------|
| `CONVEX_SITE_URL` | HTTP actions URL. Used as JWT issuer and OAuth callback base. |

### Provider

| Pattern | Example |
|---------|---------|
| `AUTH_<PROVIDER>_ID` | `AUTH_GITHUB_ID` |
| `AUTH_<PROVIDER>_SECRET` | `AUTH_GITHUB_SECRET` |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `AUTH_SESSION_TOTAL_DURATION_MS` | Max session lifetime | 30 days |
| `AUTH_SESSION_INACTIVE_DURATION_MS` | Inactive session timeout | Provider-specific |
| `AUTH_LOG_LEVEL` | `DEBUG` / `INFO` / `WARN` / `ERROR` | `INFO` |

## Production Deploy

```bash
# Set up production keys + site URL
npx @robelest/convex-auth --prod --site-url "https://myapp.com"

# Set provider secrets
npx convex env set --prod AUTH_GITHUB_ID "..."
npx convex env set --prod AUTH_GITHUB_SECRET "..."

# Deploy
npx convex deploy --cmd 'npm run build'

# Generate a portal admin link (uses hosted CDN by default)
npx @robelest/convex-auth portal link --prod

# Or self-host the portal on your deployment
npx @robelest/convex-auth portal upload --prod
npx @robelest/convex-auth portal link --prod
```

## SSR Integration

The `server()` helper from `@robelest/convex-auth/server` handles OAuth code exchange, token refresh, and httpOnly cookie management for SSR frameworks. It returns structured cookie data that works natively with every framework's cookie API.

```ts
import { server } from '@robelest/convex-auth/server'

const auth = server({ url: process.env.CONVEX_URL! })
const { cookies, redirect, token } = await auth.refresh(request)
```

| Field | Type | Description |
|-------|------|-------------|
| `cookies` | `AuthCookie[]` | Structured cookies to set (`{ name, value, options }`) |
| `redirect` | `string?` | Redirect URL after OAuth code exchange |
| `token` | `string \| null` | JWT for SSR hydration |

The `proxy()` method handles client-initiated sign-in/sign-out POST requests (returns a `Response`).

### SvelteKit

```ts
// src/hooks.server.ts
import { server } from '@robelest/convex-auth/server'
import { redirect } from '@sveltejs/kit'

export const handle = async ({ event, resolve }) => {
  const auth = server({ url: CONVEX_URL })
  const { cookies: authCookies, redirect: redirectUrl, token } = await auth.refresh(event.request)

  for (const c of authCookies) {
    event.cookies.set(c.name, c.value, c.options)
  }
  if (redirectUrl) throw redirect(302, redirectUrl)

  event.locals.token = token
  return resolve(event)
}
```

### TanStack Start

```ts
// src/routes/__root.tsx
import { server } from '@robelest/convex-auth/server'
import { getRequest, setCookie } from '@tanstack/react-start/server'

const getAuthState = createServerFn({ method: 'GET' }).handler(async () => {
  const auth = server({ url: import.meta.env.VITE_CONVEX_URL! })
  const { cookies, redirect, token } = await auth.refresh(getRequest())

  for (const c of cookies) setCookie(c.name, c.value, c.options)
  if (redirect) return { token: null, redirect }
  return { token, redirect: null }
})
```

### Next.js (App Router)

```ts
// app/layout.tsx or middleware.ts
import { server } from '@robelest/convex-auth/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

const auth = server({ url: process.env.CONVEX_URL! })
const { cookies: authCookies, redirect: redirectUrl, token } = await auth.refresh(request)

const cookieStore = await cookies()
for (const c of authCookies) cookieStore.set(c.name, c.value, c.options)
if (redirectUrl) redirect(redirectUrl)
```

## Architecture

```
Your App (convex/)
  └── components.auth             ← one component install
        ├── auth tables            ← users, accounts, sessions, groups, members, invites, keys
        ├── public functions       ← component API (internal to your app)
        ├── portalBridge           ← delegates to self-hosting sub-component
        └── selfHosting            ← @convex-dev/self-hosting (portal static files)
              └── assets table     ← uploaded files, deployments
```

### Portal serving

```
Self-hosted:
  Browser → {deployment}.convex.site/auth/*
    ├── /auth/.well-known/portal-config  → returns { convexUrl, siteUrl }
    └── /auth/**                          → static files from Convex storage

CDN (auth.robelest.com):
  Browser → auth.robelest.com/{slug}/*
    ├── SvelteKit reroute hook strips slug for route matching
    └── discoverConvexUrl() derives https://{slug}.convex.cloud from the path
```

Key design constraints of the Convex component system:
- Component functions are **always internal** from the parent's perspective. The portal client cannot call component functions directly — the app must re-export them (`portalQuery`, `portalMutation`, `portalInternal`).
- Sub-components are **fully encapsulated**. The app only sees `components.auth`, never `components.auth.selfHosting`.
- Components cannot access `ctx.auth` or `process.env`. Auth checks and env var reads happen at the app layer.

## CLI Reference

### Setup wizard

```bash
npx @robelest/convex-auth [options]
```

| Option | Description |
|--------|-------------|
| `--site-url <url>` | Frontend URL (prompts if omitted) |
| `--skip-git-check` | Don't warn when running outside a Git repo |
| `--allow-dirty-git-state` | Don't warn when Git state is dirty |

### Portal commands

```bash
# Generate an admin invite link
npx @robelest/convex-auth portal link [options]

# Upload portal to your Convex deployment (self-hosted mode)
npx @robelest/convex-auth portal upload [options]
```

**`portal link`** generates a single-use invite URL. The first person to click it becomes a portal admin.

| Option | Description | Default |
|--------|-------------|---------|
| `--component <name>` | Convex module name with portal exports | `auth` |

**`portal upload`** uploads the SvelteKit portal build to Convex storage for self-hosted serving.

| Option | Description | Default |
|--------|-------------|---------|
| `-d, --dist <path>` | Path to portal build directory | `./dist` |
| `-c, --component <name>` | Convex module name | `auth` |
| `-b, --build` | Run build before uploading | `false` |
| `-j, --concurrency <n>` | Parallel upload count | `5` |

### Deployment selection (all commands)

| Option | Description |
|--------|-------------|
| `--prod` | Target production deployment |
| `--preview-name <name>` | Target preview deployment |
| `--deployment-name <name>` | Target specific named deployment |

## Roadmap

### Done
- Password, OAuth, magic links, OTP, phone, anonymous auth
- Passkeys / WebAuthn
- TOTP (authenticator apps)
- Groups, memberships, invites with cascade operations
- Admin portal (SvelteKit, dark theme) — self-hosted and hosted CDN
- Portal CLI (`portal upload`, `portal link`)
- Class-based `Auth` API with library-native email transport
- Self-hosting as embedded sub-component
- API keys with scoped permissions, SHA-256 hashing, rate limiting
- Framework-agnostic SSR cookie API (SvelteKit, TanStack Start, Next.js)
- Hosted CDN portal at `auth.robelest.com` with path-based deployment routing

### Planned
- **Bearer Token Auth** — `Authorization: Bearer` header for API-first apps
- **Device Authorization (RFC 8628)** — OAuth device flow for CLIs/IoT
- **Arctic migration** — replace `@auth/core` with a lighter OAuth 2.0 layer
- **SSO (SAML 2.0 + OIDC)** — enterprise identity provider integration
- **SCIM 2.0 Directory Sync** — user provisioning from Okta, Azure AD, Google Workspace
- **OAuth 2.1 / OIDC Provider** — become the identity provider
- **MCP Auth** — Model Context Protocol authentication for AI agents
- **Audit logging** — structured auth event log
- **Webhooks** — fire on auth lifecycle events

---

## Contributing

```bash
bun install
bun run dev:convex
bun run test:auth
```

### Monorepo structure

| Directory | Description |
|-----------|-------------|
| `packages/auth/` | Auth component + `Auth` class + CLI |
| `packages/portal/` | Admin portal (SvelteKit + static adapter) |
| `packages/test/` | Shared test suite |
| `convex/` | Root Convex functions (dev/test) |
