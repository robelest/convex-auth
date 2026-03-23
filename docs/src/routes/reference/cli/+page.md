---
title: CLI Reference
description: Command-line options for the setup wizard.
---

<svelte:head>

  <title>CLI Reference - convex-auth</title>
</svelte:head>

# CLI Reference

## Setup wizard

```bash
pnpx @robelest/convex-auth [options]
```

The wizard runs 6 steps: configure `SITE_URL`, generate key pair, configure
`tsconfig.json`, create `convex.config`, create `auth.ts`, create `http.ts`.

## Options

| Option                     | Description                                     |
| -------------------------- | ----------------------------------------------- |
| `--site-url <url>`         | Value for `SITE_URL`; avoids interactive prompt |
| `--prod`                   | Target production deployment                    |
| `--preview-name <name>`    | Target preview deployment                       |
| `--deployment-name <name>` | Target specific named deployment                |
| `--url <url>`              | Target deployment by URL                        |
| `--admin-key <key>`        | Use explicit Convex admin key                   |
| `--variables <json>`       | Additional variables for configuration          |
| `--skip-git-check`         | Skip the "outside Git repo" warning             |
| `--allow-dirty-git-state`  | Skip all source-control checks                  |

## Enterprise mounts

To scaffold optional client-callable enterprise RPC under `convex/auth/sso/**`
and `convex/auth/scim/**`:

```bash
npx @robelest/convex-auth mount enterprise
```

The command is guided and only generates app-side mount files. It does not
change your frontend auth client, which still uses
`client({ convex, api: api.auth })`.

Generated files include nested mounts like:

- `convex/auth/sso/connection.ts`
- `convex/auth/sso/oidc.ts`
- `convex/auth/sso/saml.ts`
- `convex/auth/sso/policy.ts`
- `convex/auth/sso/audit.ts`
- `convex/auth/sso/webhook/**`
- `convex/auth/scim.ts`

After mounting, frontend code can call the generated enterprise APIs with normal
Convex hooks:

```ts
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

const createConnection = useAction(api.auth.sso.connection.create);
const configureScim = useAction(api.auth.scim.configure);
```
