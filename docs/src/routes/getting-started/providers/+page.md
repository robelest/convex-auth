---
title: Providers
description: Auth methods available in convex-auth.
---

<svelte:head>

  <title>Providers - convex-auth</title>
</svelte:head>

# Providers

## OAuth (Arctic)

OAuth is powered by [Arctic](https://arcticjs.dev) — a lightweight,
zero-dependency OAuth 2.0 library with 50+ provider implementations.

```ts
import { Google, GitHub } from "arctic";
import { OAuth } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    OAuth(
      new GitHub(process.env.AUTH_GITHUB_ID!, process.env.AUTH_GITHUB_SECRET!),
      {
        scopes: ["user:email"],
        profile: async (tokens) => {
          const res = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${tokens.accessToken()}` },
          });
          const user = await res.json();
          return { id: String(user.id), email: user.email, name: user.name };
        },
      },
    ),
    OAuth(new Google(clientId, clientSecret, redirectUri), {
      scopes: ["openid", "profile", "email"],
    }),
  ],
});
```

OIDC-compliant providers (Google, Microsoft) decode the ID token automatically —
no `profile` callback needed.

Set `AUTH_<PROVIDER>_ID` and `AUTH_<PROVIDER>_SECRET` on your deployment.

## Password

```ts
import { Password } from "@robelest/convex-auth/providers/password";

createAuth(components.auth, {
  providers: [new Password()],
});
```

## Magic Links (Email)

```ts
import { Email } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    new Email({
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
import { Passkey } from "@robelest/convex-auth/providers/passkey";

createAuth(components.auth, {
  providers: [new Passkey()],
});
```

## TOTP (Authenticator Apps)

```ts
import { Totp } from "@robelest/convex-auth/providers/totp";

createAuth(components.auth, {
  providers: [new Totp({ issuer: "My App" })],
});
```

## Anonymous

```ts
import { Anonymous } from "@robelest/convex-auth/providers/anonymous";

createAuth(components.auth, {
  providers: [new Anonymous()],
});
```

## Phone / SMS

```ts
import { Phone } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [
    new Phone({
      send: async ({ identifier, token }) => {
        // send SMS via Twilio, etc.
      },
    }),
  ],
});
```

## Enterprise SSO

```ts
import { SSO } from "@robelest/convex-auth/providers";

createAuth(components.auth, {
  providers: [new SSO()],
});
```

Adding `new SSO()` enables the `auth.sso.*` namespace and registers OIDC, SAML,
and SCIM HTTP routes. See the [SSO overview](/sso/overview/) for details.
