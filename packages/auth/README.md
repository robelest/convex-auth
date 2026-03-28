# @robelest/convex-auth

Component-first authentication for [Convex](https://convex.dev). One component,
one setup API, full TypeScript support.

## Features

- **Convex-native setup API** — `createAuth(components.auth, { providers })`
  gives you everything.
- **OAuth via Arctic** — 50+ providers through [Arctic](https://arcticjs.dev),
  zero-dependency OAuth 2.0.
- **Fluent Convex builders (recommended)** — cleaner auth-aware API handling
  with middleware and explicit `.public()` / `.internal()` exports.
- **Password, passkeys, TOTP, magic links, OTP, phone, anonymous** — all built
  in.
- **Device Authorization (RFC 8628)** — authenticate CLIs, smart TVs, and IoT
  devices.
- **API keys** — scoped permissions, SHA-256 hashed storage, optional rate
  limiting.
- **Groups, memberships, invites** — hierarchical multi-tenancy with roles.
- **SSR support** — framework-agnostic httpOnly cookie API (SvelteKit, TanStack
  Start, Next.js).
- **Context enrichment** — zero-boilerplate `ctx.auth.userId` via `auth.ctx()`.

## Install

```bash
bun add @robelest/convex-auth
```

> Renamed package: if you are migrating from earlier previews, replace
> `@convex-dev/auth` with `@robelest/convex-auth` in imports and CLI commands.

## Quick Start

Before running setup:

- Run from your app project root (must include `package.json`).
- Make sure a Convex deployment can be resolved. By default the CLI reads a
  typed `CONVEX_DEPLOYMENT` like `dev:my-deployment` (usually set by
  `npx convex dev`), or you can pass `--prod`, `--preview-name`,
  `--deployment-name`, `--url`, or `--admin-key`.
- Use `--url` for explicit or self-hosted targets. Typed deployment and
  admin-key parsing only applies to Convex Cloud selections.

```bash
bunx @robelest/convex-auth
```

The interactive CLI sets up your Convex component, auth config, and HTTP routes
in under a minute.

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
import { createAuth } from "@robelest/convex-auth/component";
import { components } from "./_generated/api";
import { GitHub } from "arctic";
import { OAuth } from "@robelest/convex-auth/providers";

const auth = createAuth(components.auth, {
  providers: [
    OAuth(
      new GitHub(process.env.AUTH_GITHUB_ID!, process.env.AUTH_GITHUB_SECRET!),
    ),
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

For new projects, we recommend `fluent-convex` for auth middleware composition
and cleaner API exports.

```ts
// convex/functions.ts
import { createBuilder } from "fluent-convex";
import { WithZod } from "fluent-convex/zod";
import type { DataModel } from "./_generated/dataModel";
import { auth } from "./auth";

const convex = createBuilder<DataModel>();

// `auth.context(ctx)` resolves { userId, user, groupId, role, grants }
// and throws before the handler runs when unauthenticated.
const withRequiredAuth = convex.createMiddleware<any, { auth: any }>(
  async (ctx, next) => {
    return next({ ...ctx, auth: await auth.context(ctx) });
  },
);

export const query = convex.query().use(withRequiredAuth).extend(WithZod);
export const mutation = convex.mutation().use(withRequiredAuth).extend(WithZod);
```

`auth.ctx()` works with `convex-helpers` and other custom builder setups.

## Providers

| Provider          | Import                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| OAuth (Arctic)    | `import { OAuth } from "@robelest/convex-auth/providers"`               |
| Password          | `import { Password } from "@robelest/convex-auth/providers"`            |
| Passkey           | `import { Passkey } from "@robelest/convex-auth/providers"`             |
| TOTP              | `import { Totp } from "@robelest/convex-auth/providers"`                |
| Phone/SMS         | `import { Phone } from "@robelest/convex-auth/providers"`               |
| Anonymous         | `import { Anonymous } from "@robelest/convex-auth/providers"`           |
| Device (RFC 8628) | `import { Device } from "@robelest/convex-auth/providers"`              |

## Enterprise

The enterprise direction is a headless SDK/API rather than a hosted admin UI.

- `auth.sso.*` stores enterprise config on top of `auth.group`, with distinct
  `admin` and `client` helper surfaces.
- Standardized helpers are exposed as `auth.sso.admin.connection.*`,
  `auth.sso.admin.connection.domain.*`, `auth.sso.admin.oidc.*`,
  `auth.sso.admin.saml.*`, `auth.sso.admin.policy.*`,
  `auth.sso.admin.audit.list`, `auth.sso.admin.webhook.endpoint.*`,
  `auth.sso.client.signIn`, `auth.sso.client.metadata`, and
  `auth.scim.admin.configure/get/validate`.
- Enterprise helpers are server-side primitives. Consumers can build and expose
  their own Convex RPC wrappers when needed.
- `auth.sso.client.metadata(...)` uses the local `@robelest/samlify` package to
  parse IdP metadata and generate SP metadata from the same setup state.

## Documentation

See the full [README](https://github.com/robelest/convex-auth#readme) for
detailed usage, API reference, SSR integration, and more.
