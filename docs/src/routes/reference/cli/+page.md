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
| `--secondary-url <urls>`   | Comma-separated value for `SECONDARY_URL`                 |
| `--prod`                   | Target production deployment                              |
| `--preview-name <name>`    | Target preview deployment                                 |
| `--deployment-name <name>` | Target specific named deployment                          |
| `--url <url>`              | Target deployment by explicit URL or self-hosted endpoint |
| `--admin-key <key>`        | Use explicit admin key (typed for Convex Cloud)           |
| `--variables <json>`       | Additional variables for configuration                    |
| `--skip-git-check`         | Skip the "outside Git repo" warning                       |
| `--allow-dirty-git-state`  | Skip all source-control checks                            |

## Group Connection API

Group SSO RPC is app-owned. Create a single file like
`convex/auth/group.ts` and export only the helpers your app needs:

```ts
import { createAuthGroupSso } from "@robelest/convex-auth/server";
import { auth } from "../auth";
import { roles } from "../roles";

export const { createConnection, configureScim } = createAuthGroupSso(auth, {
  permissions: {
    sso: { require: [roles.orgAdmin] },
    scim: { require: [roles.orgAdmin] },
  },
  access: async (ctx, input, requiredRoles) => {
    if (!input.groupId) {
      throw new Error("Group scope required");
    }
    await auth.member.require(ctx, {
      userId: input.userId,
      groupId: input.groupId,
      roleIds: requiredRoles.map((role) => role.id),
    });
  },
});
```

Example:

```bash
pnpx @robelest/convex-auth --site-url "https://app.example.com" --secondary-url "http://localhost:3000,http://localhost:5173"
```

Then call the exported functions with normal Convex hooks:

```ts
import { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

const createConnection = useAction(api.auth.group.createConnection);
const configureScim = useAction(api.auth.group.configureScim);
```

Pass a concrete `groupId` when calling `createConnection(...)`.
