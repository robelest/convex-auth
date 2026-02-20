# @robelest/convex-auth

Component-first authentication for [Convex](https://convex.dev). One component, one class, full TypeScript support.

## Features

- **Class-based API** — `new Auth(components.auth, { providers })` gives you everything.
- **OAuth via Arctic** — 50+ providers through [Arctic](https://arcticjs.dev), zero-dependency OAuth 2.0.
- **Fluent Convex builders (recommended)** — cleaner auth-aware API handling with middleware and explicit `.public()` / `.internal()` exports.
- **Password, passkeys, TOTP, magic links, OTP, phone, anonymous** — all built in.
- **Device Authorization (RFC 8628)** — authenticate CLIs, smart TVs, and IoT devices.
- **API keys** — scoped permissions, SHA-256 hashed storage, optional rate limiting.
- **Groups, memberships, invites** — hierarchical multi-tenancy with roles.
- **SSR support** — framework-agnostic httpOnly cookie API (SvelteKit, TanStack Start, Next.js).
- **Context enrichment** — zero-boilerplate `ctx.auth.userId` via `AuthCtx`.

## Install

```bash
bun add @robelest/convex-auth
```

> Renamed package: if you are migrating from earlier previews, replace
> `@convex-dev/auth` with `@robelest/convex-auth` in imports and CLI commands.

## Quick Start

```bash
bunx @robelest/convex-auth
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
import { Auth } from "@robelest/convex-auth/component";
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
```

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.http.add(http);
export default http;
```

## Recommended Convex API Handling (`fluent-convex`)

For new projects, we recommend `fluent-convex` for auth middleware composition and cleaner API exports.

```ts
// convex/functions.ts
import { createBuilder } from "fluent-convex";
import { WithZod } from "fluent-convex/zod";
import type { DataModel } from "./_generated/dataModel";
import { auth } from "./auth";

const convex = createBuilder<DataModel>();

const withRequiredAuth = convex.createMiddleware<any, { auth: any }>(
  async (ctx, next) => {
    const userId = await auth.user.require(ctx);
    const user = await auth.user.get(ctx, userId);
    return next({ ...ctx, auth: { ...ctx.auth, userId, user } });
  },
);

export const query = convex.query().use(withRequiredAuth).extend(WithZod);
export const mutation = convex.mutation().use(withRequiredAuth).extend(WithZod);
```

`AuthCtx` from `@robelest/convex-auth/component` remains supported if your project already uses `convex-helpers`.

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

See the full [README](https://github.com/robelest/convex-auth#readme) for detailed usage, API reference, SSR integration, and more.
