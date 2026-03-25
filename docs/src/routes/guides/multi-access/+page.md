---
title: Multi-Access
description: One app, any auth method — session, API key, SSO, device flow.
---

<svelte:head>

  <title>Multi-Access - convex-auth</title>
</svelte:head>

# Multi-Access

Every auth path resolves to the same `userId`. They compose naturally because
`userId` is the single shared anchor across all access patterns.

## `auth.user.id` with optional request

Pass a `Request` to `auth.user.id(ctx, request)` and it tries session JWT first,
then `Authorization: Bearer sk_...` API key:

```ts
http.route({
  path: "/api/data",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const userId = await auth.user.id(ctx, request);
    if (userId === null) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }
    const data = await ctx.runQuery(internal.data.forUser, { userId });
    return Response.json(data);
  }),
});
```

## How each access pattern resolves

| How the user authenticated                | How `userId` is available                            |
| ----------------------------------------- | ---------------------------------------------------- |
| Browser (password, email, passkey, OAuth) | `auth.user.id(ctx)`                                  |
| Enterprise SSO (OIDC/SAML)                | Same as browser — SSO completes as a session         |
| Device flow (RFC 8628, CLI/TV)            | Same as browser — device poll returns session tokens |
| API key (machine/automation)              | `ctx.key.userId` or `auth.user.id(ctx, request)`     |

## Composing primitives

```ts
// Works for any authenticated caller
async function getMyGroups(ctx: any, userId: string) {
  const { items } = await auth.member.list(ctx, { where: { userId } });
  return items;
}

// Browser session
const handler = query(async (ctx) => {
  const userId = await auth.user.id(ctx);
  if (userId === null) throw new Error("Not signed in");
  return getMyGroups(ctx, userId);
});

// API key HTTP endpoint
const apiHandler = auth.http.action(async (ctx) => {
  return getMyGroups(ctx, ctx.key.userId);
});

// Any HTTP action (session or API key)
const flexHandler = httpAction(async (ctx, request) => {
  const userId = await auth.user.id(ctx, request);
  if (userId === null) throw new Error("Not signed in");
  return Response.json(await getMyGroups(ctx, userId));
});
```
