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

The CLI expects typed deployment identifiers such as `dev:my-deployment`,
`prod:my-deployment`, or `preview:my-deployment` for Convex Cloud. Use `--url`
for explicit or self-hosted targets.

## Options

| Option                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `--site-url <url>`         | Value for `SITE_URL`; avoids interactive prompt           |
| `--prod`                   | Target production deployment                              |
| `--preview-name <name>`    | Target preview deployment                                 |
| `--deployment-name <name>` | Target specific named deployment                          |
| `--url <url>`              | Target deployment by explicit URL or self-hosted endpoint |
| `--admin-key <key>`        | Use explicit admin key (typed for Convex Cloud)           |
| `--variables <json>`       | Additional variables for configuration                    |
| `--skip-git-check`         | Skip the "outside Git repo" warning                       |
| `--allow-dirty-git-state`  | Skip all source-control checks                            |

## Enterprise API

Enterprise RPC is app-owned. Create a single file like
`convex/auth/enterprise.ts` and export only the helpers your app needs:

```ts
import { enterprise } from "@robelest/convex-auth/server";
import { auth, authorized } from "../auth";

export const { createConnection, configureScim } = enterprise(auth, {
  authorized,
});
```

Then call the exported functions with normal Convex hooks:

```ts
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

const createConnection = useAction(api.auth.enterprise.createConnection);
const configureScim = useAction(api.auth.enterprise.configureScim);
```
