---
title: Installation
description: Set up convex-auth in your project.
---

<script>
  import Tabs from '$lib/components/docs/Tabs.svelte';
  import TabItem from '$lib/components/docs/TabItem.svelte';
  import Card from '$lib/components/docs/Card.svelte';
  import CardGrid from '$lib/components/docs/CardGrid.svelte';
</script>

<svelte:head>

  <title>Installation - convex-auth</title>
</svelte:head>

# Installation

## Install

<Tabs syncKey="pkg">
  <TabItem label="npm">

```bash
npm install @robelest/convex-auth
npx convex dev
npx @robelest/convex-auth
```

To skip the interactive prompt:

```bash
npx @robelest/convex-auth --site-url "http://localhost:5173"
```

  </TabItem>
  <TabItem label="pnpm">

```bash
pnpm add @robelest/convex-auth
pnpx convex dev
pnpx @robelest/convex-auth
```

To skip the interactive prompt:

```bash
pnpx @robelest/convex-auth --site-url "http://localhost:5173"
```

  </TabItem>
  <TabItem label="yarn">

```bash
yarn add @robelest/convex-auth
yarn dlx convex dev
yarn dlx @robelest/convex-auth
```

To skip the interactive prompt:

```bash
yarn dlx @robelest/convex-auth --site-url "http://localhost:5173"
```

  </TabItem>
</Tabs>

## Quick Setup (CLI)

The setup flow is:

1. install `@robelest/convex-auth`
2. start a Convex deployment with `convex dev`
3. run the auth setup wizard

The wizard handles everything:

- key generation
- `convex.config.ts`
- `auth.ts`
- `http.ts`

## API layers

<CardGrid>
  <Card title="Client auth flow">
    <code>signIn</code>, <code>signOut</code>, and <code>store</code> are the only required client-callable auth
    functions. Frontends use them through <code>client({'{'} convex, api: api.auth {'}'}).</code>
  </Card>
  <Card title="Server helpers">
    `auth.user.*`, `auth.sso.*`, and `auth.scim.admin.*` are server-side helpers for
    Convex code. They are not automatically public RPC.
  </Card>
  <Card title="Optional enterprise RPC">
    If your app wants client-callable enterprise admin APIs, expose app-owned
    wrappers such as <code>convex/auth/enterprise.ts</code>.
  </Card>
</CardGrid>

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

### 3. Wire up HTTP routes

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.http.add(http);
export default http;
```

`auth.http.add` registers OAuth callbacks and JWKS endpoints in one call.
