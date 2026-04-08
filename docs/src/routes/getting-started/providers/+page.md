---
title: Providers
description: Auth methods available in convex-auth.
---

<svelte:head>

  <title>Providers - convex-auth</title>
</svelte:head>

# Providers

## OAuth

convex-auth currently ships first-party OAuth wrappers for Google, GitHub,
Apple, and Microsoft. Each wrapper owns the provider defaults and automatically
derives the callback URL from `CONVEX_SITE_URL` unless you override it.

```ts
import {
  anonymous,
  apple,
  custom,
  email,
  github,
  google,
  microsoft,
  passkey,
  password,
  phone,
  sso,
  totp,
} from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    github({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
    google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    microsoft({
      tenant: process.env.AUTH_MICROSOFT_TENANT_ID!,
      clientId: process.env.AUTH_MICROSOFT_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_SECRET!,
    }),
  ],
});
```

GitHub includes a built-in profile fetch. Google, Apple, and Microsoft rely on
their ID token claims by default.

### Google

- Import: `@robelest/convex-auth/providers`
- Factory:
  `google({ clientId, clientSecret, redirectUri?, scopes?, accountLinking? })`
- Default scopes: `openid profile email`
- Required env: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

```ts
import { google } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
});
```

Use `redirectUri` only when you need to override the default callback route.

### GitHub

- Import: `@robelest/convex-auth/providers`
- Factory:
  `github({ clientId, clientSecret, redirectUri?, scopes?, accountLinking? })`
- Default scopes: `user:email`
- Required env: `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`

```ts
import { github } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    github({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
  ],
});
```

The GitHub wrapper performs the profile and email fetch for you.

### Apple

- Import: `@robelest/convex-auth/providers`
- Factory:
  `apple({ clientId, teamId, keyId, privateKey, redirectUri?, scopes?, accountLinking? })`
- Default scopes: `name email`
- Required env: `AUTH_APPLE_ID`, `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`,
  `AUTH_APPLE_PRIVATE_KEY`

```ts
import { apple } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    apple({
      clientId: process.env.AUTH_APPLE_ID!,
      teamId: process.env.AUTH_APPLE_TEAM_ID!,
      keyId: process.env.AUTH_APPLE_KEY_ID!,
      privateKey: process.env.AUTH_APPLE_PRIVATE_KEY!,
    }),
  ],
});
```

Apple may only return name data during the initial consent flow, so plan to
persist any extra profile fields you care about on first sign-in.

### Microsoft

- Import: `@robelest/convex-auth/providers`
- Factory:
  `microsoft({ tenant, clientId, clientSecret?, redirectUri?, scopes?, accountLinking? })`
- Default scopes: `openid profile email`
- Required env: `AUTH_MICROSOFT_TENANT_ID`, `AUTH_MICROSOFT_ID`
- Optional env: `AUTH_MICROSOFT_SECRET`

```ts
import { microsoft } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    microsoft({
      tenant: process.env.AUTH_MICROSOFT_TENANT_ID!,
      clientId: process.env.AUTH_MICROSOFT_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_SECRET!,
    }),
  ],
});
```

The Microsoft wrapper validates the ID token and nonce internally.

### OAuth imports

- `@robelest/convex-auth/providers`

## Custom OAuth

```ts
createAuth(components.auth, {
  providers: [
    custom({
      id: "discord",
      clientId: process.env.AUTH_DISCORD_ID!,
      clientSecret: process.env.AUTH_DISCORD_SECRET!,
      scopes: ["identify", "email"],
      authorization: {
        url: "https://discord.com/oauth2/authorize",
        pkce: "optional",
      },
      token: {
        url: "https://discord.com/api/oauth2/token",
        authMethod: "body",
      },
      profile: async ({ accessToken }) => {
        const res = await fetch("https://discord.com/api/users/@me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const user = await res.json();
        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
        };
      },
    }),
  ],
});
```

Use `custom()` when the provider is OAuth-based but does not have a first-party
wrapper yet. The `profile()` callback receives a stable token object owned by
convex-auth so the public API does not depend on Arctic.

## Password

```ts
createAuth(components.auth, {
  providers: [password()],
});
```

## Magic Links (Email)

```ts
createAuth(components.auth, {
  providers: [
    email({
      from: "My App <noreply@example.com>",
      send: async (ctx, { from, to, subject, html }) => {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({ from, to, subject, html });
      },
    }),
  ],
});
```

## Passkeys / WebAuthn

```ts
createAuth(components.auth, {
  providers: [passkey()],
});
```

## TOTP (Authenticator Apps)

```ts
createAuth(components.auth, {
  providers: [totp({ issuer: "My App" })],
});
```

## Anonymous

```ts
createAuth(components.auth, {
  providers: [anonymous()],
});
```

## Phone / SMS

```ts
createAuth(components.auth, {
  providers: [
    phone({
      send: async ({ identifier, token }) => {
        // send SMS via Twilio, etc.
      },
    }),
  ],
});
```

## Group SSO

```ts
createAuth(components.auth, {
  providers: [sso()],
});
```

Adding `sso()` enables the `auth.group.sso.*` namespace and registers OIDC,
SAML, and SCIM HTTP routes. See the [SSO overview](/sso/overview/) for details.
