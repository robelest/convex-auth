---
title: Environment Variables
description: Required and optional environment variables for convex-auth.
---

<svelte:head>

  <title>Environment Variables - convex-auth</title>
</svelte:head>

# Environment Variables

## Required

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `JWT_PRIVATE_KEY`            | Signs session JWTs                          |
| `JWKS`                       | JSON Web Key Set for verification           |
| `AUTH_SECRET_ENCRYPTION_KEY` | Encrypts stored group SSO secrets           |
| `SITE_URL`                   | Frontend URL for OAuth/magic link redirects |

These are set automatically by the CLI setup wizard.

## System (auto-provided by Convex)

| Variable          | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `CONVEX_SITE_URL` | HTTP actions URL. Used as JWT issuer and OAuth callback base. |

Your `convex/auth.config.ts` should trust this same value as the native Convex
JWT issuer:

```ts
export default {
  providers: [
    {
      domain: `${process.env.CONVEX_SITE_URL}/auth`,
      applicationID: "convex",
    },
  ],
};
```

## Provider

| Pattern                  | Example              |
| ------------------------ | -------------------- |
| `AUTH_<PROVIDER>_ID`     | `AUTH_GITHUB_ID`     |
| `AUTH_<PROVIDER>_SECRET` | `AUTH_GITHUB_SECRET` |

### OAuth provider env

| Provider  | Required variables                                                                   | Optional variables      |
| --------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Google    | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`                                               | -                       |
| GitHub    | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`                                               | -                       |
| Apple     | `AUTH_APPLE_ID`, `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, `AUTH_APPLE_PRIVATE_KEY` | -                       |
| Microsoft | `AUTH_MICROSOFT_TENANT_ID`, `AUTH_MICROSOFT_ID`                                      | `AUTH_MICROSOFT_SECRET` |

OAuth provider callbacks default to:

```text
${CONVEX_SITE_URL}/auth/callback/<provider>
```

This uses `CONVEX_AUTH_HTTP_PREFIX`, which defaults to `/auth`, matching the
default `auth.http()` route prefix. Pass `redirectUri` in provider config when
you want to override that default.

## Optional

| Variable                            | Purpose                                                                   | Default           |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------- |
| `SECONDARY_URL`                     | Comma-separated extra frontend origins for passkeys and shared auth flows | -                 |
| `AUTH_SESSION_TOTAL_DURATION_MS`    | Max session lifetime                                                      | 30 days           |
| `AUTH_SESSION_INACTIVE_DURATION_MS` | Inactive session timeout                                                  | Provider-specific |
| `AUTH_LOG_LEVEL`                    | `DEBUG` / `INFO` / `WARN` / `ERROR`                                       | `INFO`            |

### `.well-known` content

These drive the [.well-known endpoints](/reference/well-known) — leave them
unset to disable a given endpoint (it then returns 404).

| Variable                    | Purpose                                                            | Default           |
| --------------------------- | ------------------------------------------------------------------ | ----------------- |
| `IOS_APP_IDS`               | Comma-separated `TEAMID.bundle.id` for `apple-app-site-association`| -                 |
| `IOS_APPLINK_PATHS`         | Comma-separated path patterns for `applinks` (e.g., `/auth/*`)     | `/auth/*,/callback/*` |
| `ANDROID_APP_LINKS`         | `package:FP1;package2:FP2` for `assetlinks.json`                   | -                 |
| `WEBAUTHN_ALT_ORIGINS`      | Comma-separated origins for `/.well-known/webauthn`                | falls back to `SECONDARY_URL` |
| `CHANGE_PASSWORD_URL`       | Redirect target for `/.well-known/change-password`                 | -                 |
| `SECURITY_CONTACT`          | `Contact:` for `security.txt` (`mailto:` or `https:`)              | -                 |
| `SECURITY_TXT_EXPIRES_DAYS` | Days until `Expires:` in `security.txt`                            | 365               |

`SITE_URL` remains the canonical frontend URL used for generated links and
default redirects. Use `SECONDARY_URL` to allow additional localhost or hosted
frontend origins to share the same auth instance:

```bash
SITE_URL=https://app.example.com
SECONDARY_URL=http://localhost:3000,http://localhost:5173,https://staging.example.com
```
