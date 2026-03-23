---
title: Production Deploy
description: Deploy convex-auth to production.
---

<script>
  import Tabs from '$lib/components/docs/Tabs.svelte';
  import TabItem from '$lib/components/docs/TabItem.svelte';
</script>

<svelte:head>

  <title>Production Deploy - convex-auth</title>
</svelte:head>

# Production Deploy

## Setup production keys

<Tabs syncKey="pkg">
  <TabItem label="npm">

`npx @robelest/convex-auth --prod --site-url "https://myapp.com"`

  </TabItem>
  <TabItem label="pnpm">

`pnpx @robelest/convex-auth --prod --site-url "https://myapp.com"`

  </TabItem>
  <TabItem label="yarn">

`yarn dlx @robelest/convex-auth --prod --site-url "https://myapp.com"`

  </TabItem>
</Tabs>

## Set provider secrets

<Tabs syncKey="pkg">
  <TabItem label="npm">

`npx convex env set --prod AUTH_GITHUB_ID "..."` then
`npx convex env set --prod AUTH_GITHUB_SECRET "..."`

  </TabItem>
  <TabItem label="pnpm">

`pnpx convex env set --prod AUTH_GITHUB_ID "..."` then
`pnpx convex env set --prod AUTH_GITHUB_SECRET "..."`

  </TabItem>
  <TabItem label="yarn">

`yarn dlx convex env set --prod AUTH_GITHUB_ID "..."` then
`yarn dlx convex env set --prod AUTH_GITHUB_SECRET "..."`

  </TabItem>
</Tabs>

## Deploy

<Tabs syncKey="pkg">
  <TabItem label="npm">

```bash
npx convex deploy --cmd 'npm run build'
```

  </TabItem>
  <TabItem label="pnpm">

```bash
pnpx convex deploy --cmd 'pnpm run build'
```

  </TabItem>
  <TabItem label="yarn">

```bash
yarn dlx convex deploy --cmd 'yarn build'
```

  </TabItem>
</Tabs>

## Checklist

- `SITE_URL` is set to your production domain (not `localhost`)
- `JWT_PRIVATE_KEY`, `JWKS`, and `AUTH_SECRET_ENCRYPTION_KEY` are set (the CLI
  handles this)
- Provider secrets (`AUTH_*_ID`, `AUTH_*_SECRET`) are configured
- `CONVEX_SITE_URL` is auto-provided by Convex
- OAuth callback URLs are registered with your providers pointing to
  `CONVEX_SITE_URL`
