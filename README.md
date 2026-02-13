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
npx @robelest/convex-auth --site-url "http://localhost:5173"
```

The CLI scaffolds `convex/convex.config.ts`, `convex/auth.ts`, and `convex/http.ts`, then sets `SITE_URL`, `JWT_PRIVATE_KEY`, and `JWKS` on your deployment.

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

## Admin Portal

A dark-themed SvelteKit admin dashboard served directly from your Convex deployment at `/<component_name>` (default: `/auth`). No separate hosting required.

The portal lets you:
- View and search all users
- Inspect user details, accounts, and sessions
- Revoke active sessions
- Manage admin access via invite links

### Setup

1. **Build and upload the portal:**

```bash
npx @robelest/convex-auth portal upload
```

2. **Generate an admin invite link:**

```bash
npx @robelest/convex-auth portal link
```

3. **Open the link** — sign in with your email (magic link), and you're an admin.

That's it. The portal is now live at `https://<your-deployment>.convex.site/auth`.

### How it works

- Portal static files are stored in Convex via the `@convex-dev/self-hosting` sub-component (installed automatically inside the auth component).
- `addHttpRoutes` registers SPA-fallback static file serving at `/auth`.
- The portal uses a `portal` email provider (auto-registered by `Auth`) for magic link sign-in.
- Admin access is controlled by invite records with `role: "portalAdmin"`. The first admin is created via `portal link`.
- All portal data flows through `portalQuery`, `portalMutation`, and `portalInternal` — exported from your `convex/auth.ts`. The portal client calls these, not component internals directly (components can't expose public endpoints to external clients).

### CLI commands

```bash
# Upload portal static files (builds + deploys)
npx @robelest/convex-auth portal upload

# Upload to production
npx @robelest/convex-auth portal upload --prod

# Generate admin invite link
npx @robelest/convex-auth portal link

# Generate link for production
npx @robelest/convex-auth portal link --prod

# Specify the convex module name (default: "auth")
npx @robelest/convex-auth portal link --component myAuth
```

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

### Password

```ts
import password from "@robelest/convex-auth/providers/password";

new Auth(components.auth, {
  providers: [password],
});
```

Password with email verification:

```ts
import password from "@robelest/convex-auth/providers/password";
import email from "@robelest/convex-auth/providers/email";

const otp = email({
  id: "resend-otp",
  async sendVerificationRequest({ identifier, token }) {
    // send OTP via your email provider
  },
});

new Auth(components.auth, {
  providers: [
    password({ id: "password-with-verify", verify: otp }),
    otp,
  ],
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

# Upload portal to production (optional)
npx @robelest/convex-auth portal upload --prod
npx @robelest/convex-auth portal link --prod
```

## Architecture

```
Your App (convex/)
  └── components.auth          ← one component install
        ├── auth tables         ← users, accounts, sessions, groups, members, invites
        ├── public functions    ← component API (internal to your app)
        ├── portalBridge        ← delegates to self-hosting sub-component
        └── selfHosting         ← @convex-dev/self-hosting (portal static files)
              └── assets table  ← uploaded files, deployments
```

Key design constraints of the Convex component system:
- Component functions are **always internal** from the parent's perspective. The portal client cannot call component functions directly — the app must re-export them (`portalQuery`, `portalMutation`, `portalInternal`).
- Sub-components are **fully encapsulated**. The app only sees `components.auth`, never `components.auth.selfHosting`.
- Components cannot access `ctx.auth` or `process.env`. Auth checks and env var reads happen at the app layer.

## CLI Options

| Option | Description |
|--------|-------------|
| `--site-url <url>` | Frontend URL (prompts if omitted) |
| `--prod` | Target production deployment |
| `--preview-name <name>` | Target preview deployment |
| `--deployment-name <name>` | Target specific deployment |
| `portal upload` | Build and upload portal static files |
| `portal link` | Generate admin invite link |

## Roadmap

### Done
- Password, OAuth, magic links, OTP, phone, anonymous auth
- Passkeys / WebAuthn
- TOTP (authenticator apps)
- Groups, memberships, invites with cascade operations
- Admin portal (SvelteKit, dark theme, self-hosted via Convex)
- Portal CLI (`portal upload`, `portal link`)
- Class-based `Auth` API
- Self-hosting as embedded sub-component

### Planned
- **API Keys** — hashed key storage, per-key rate limiting, scoped permissions
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
