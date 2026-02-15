# @robelest/convex-auth

Component-first authentication for [Convex](https://convex.dev). One component, one class, full TypeScript support.

## Features

- **Class-based API** — `new Auth(components.auth, { providers })` gives you everything.
- **OAuth via Arctic** — 50+ providers through [Arctic](https://arcticjs.dev), zero-dependency OAuth 2.0.
- **Password, passkeys, TOTP, magic links, OTP, phone, anonymous** — all built in.
- **Device Authorization (RFC 8628)** — authenticate CLIs, smart TVs, and IoT devices.
- **API keys** — scoped permissions, SHA-256 hashed storage, optional rate limiting.
- **Groups, memberships, invites** — hierarchical multi-tenancy with roles.
- **Admin portal** — dark-themed SvelteKit dashboard, self-hosted or CDN.
- **SSR support** — framework-agnostic httpOnly cookie API (SvelteKit, TanStack Start, Next.js).
- **Context enrichment** — zero-boilerplate `ctx.auth.userId` via `AuthCtx`.

## Install

```bash
npm install @robelest/convex-auth
```

## Quick Start

```bash
npx @robelest/convex-auth
```

The interactive CLI sets up your Convex component, auth config, and HTTP routes in under a minute.

## Manual Setup

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import auth from "@robelest/convex-auth/convex.config";

const app = defineApp();
app.use(auth);
export default app;
```

```ts
// convex/auth.ts
import { Auth, Portal } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";
import { GitHub } from "arctic";
import { OAuth } from "@robelest/convex-auth/providers";

const auth = new Auth(components.auth, {
  providers: [
    OAuth(new GitHub(process.env.AUTH_GITHUB_ID!, process.env.AUTH_GITHUB_SECRET!)),
  ],
});

export { auth };
export const { signIn, signOut, store } = auth;
export const { portalQuery, portalMutation, portalInternal } = Portal(auth);
```

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.http.add(http);
export default http;
```

## Providers

| Provider | Import |
|----------|--------|
| OAuth (Arctic) | `import { OAuth } from "@robelest/convex-auth/providers"` |
| Password | `import password from "@robelest/convex-auth/providers/password"` |
| Passkey | `import passkey from "@robelest/convex-auth/providers/passkey"` |
| TOTP | `import totp from "@robelest/convex-auth/providers/totp"` |
| Phone/SMS | `import phone from "@robelest/convex-auth/providers/phone"` |
| Anonymous | `import anonymous from "@robelest/convex-auth/providers/anonymous"` |
| Device (RFC 8628) | `import { Device } from "@robelest/convex-auth/providers"` |

## Documentation

See the full [README](https://github.com/robelest/convex-auth#readme) for detailed usage, API reference, SSR integration, admin portal setup, and more.
