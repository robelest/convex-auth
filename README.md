## Features

- **Every auth method** — Password, Google/GitHub/Apple/Microsoft OAuth, magic
  links, passkeys, TOTP, anonymous, phone, device flow (RFC 8628)
- **Group SSO** — OIDC, SAML 2.0, SCIM 2.0 via `sso()` with conditional
  TypeScript gating
- **API keys** — Scoped permissions, per-key rate limiting, rotation, SHA-256
  hashing
- **Groups and memberships** — Hierarchical groups, roles, invites, cascade
  operations
- **SSR** — Cookie-based auth for SvelteKit, TanStack Start, Next.js
- **Multi-access** — `auth.ctx()`, `auth.context(ctx)`, and
  `auth.request.context(ctx, request)` cover app, imperative, and raw HTTP auth
- **Convex component** — Isolated tables, typed helpers, zero-config defaults

## Documentation

**[convex-auth.pages.dev](https://convex-auth.pages.dev)**

| Section                                                                        | Description                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [Getting Started](https://convex-auth.pages.dev/getting-started/installation/) | Installation, providers, environment variables                  |
| [API Reference](https://convex-auth.pages.dev/api/user/)                       | `auth.user`, `auth.session`, `auth.group`, `auth.key`, and more |
| [Group SSO](https://convex-auth.pages.dev/sso/overview/)                       | OIDC, SAML, SCIM, audit, webhooks                               |
| [SSR Integration](https://convex-auth.pages.dev/ssr/overview/)                 | SvelteKit, TanStack Start, Next.js                              |
| [Guides](https://convex-auth.pages.dev/guides/multi-access/)                   | Multi-access, device flow, authorization, production            |
| [Reference](https://convex-auth.pages.dev/reference/config/)                   | Config options, error codes, CLI, architecture                  |

## Contributing

```bash
pnpm install
vp run check
vp test --run --project convex
```

| Directory          | Description                                    |
| ------------------ | ---------------------------------------------- |
| `packages/auth`    | Auth component, server helpers, providers, CLI |
| `packages/samlify` | Edge-compatible SAML runtime (local fork)      |
| `tests/`           | Vitest test suite (convex + node projects)     |
| `docs/`            | Starlight documentation site                   |

## License

[Apache-2.0](./LICENSE)
