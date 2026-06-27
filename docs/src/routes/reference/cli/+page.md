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

Group SSO RPC is app-owned. Create a single file like `convex/auth/group.ts` and
export only the helpers your app needs:

```ts
import { v } from "convex/values";
import { authMutation } from "./functions";
import { auth } from "../auth";
import { roles } from "../roles";

// Expose only the helpers your app needs — the same authMutation/authQuery
// pattern as the rest of your app. Authorize with auth.member.assert, then
// call the flat auth.connection.* facade.
export const createConnection = authMutation({
  args: {
    groupId: v.string(),
    protocol: v.union(v.literal("oidc"), v.literal("saml")),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await auth.member.assert(ctx, {
      userId: ctx.auth.userId,
      groupId: args.groupId,
      roleIds: [roles.orgAdmin.id],
    });
    return auth.connection.create(ctx, args);
  },
});

export const setScim = authMutation({
  args: { connectionId: v.string() },
  handler: async (ctx, args) => {
    const { groupId } = await auth.connection.get(ctx, { id: args.connectionId });
    await auth.member.assert(ctx, { userId: ctx.auth.userId, groupId, roleIds: [roles.orgAdmin.id] });
    return auth.connection.scim.set(ctx, args);
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
const setScim = useAction(api.auth.group.setScim);
```

Pass a concrete `groupId` when calling `createConnection(...)`.
