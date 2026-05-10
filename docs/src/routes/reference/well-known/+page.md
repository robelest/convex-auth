---
title: .well-known endpoints
description: Standard discovery endpoints for OIDC, native passkeys, password managers, and security disclosure.
---

<svelte:head>

  <title>.well-known endpoints - convex-auth</title>
</svelte:head>

# `.well-known` endpoints

A comprehensive cross-platform auth experience needs several `.well-known`
endpoints. The convex-auth library serves OIDC discovery on the Convex
backend and ships content generators for the rest, which apps host on the
frontend domain that matches the WebAuthn relying-party (RP) ID.

## At a glance

| Endpoint                                  | Hosted on                  | Required for                          |
| ----------------------------------------- | -------------------------- | ------------------------------------- |
| `/auth/.well-known/openid-configuration`  | `CONVEX_SITE_URL` (auto)   | OIDC discovery (consumers of JWTs)    |
| `/auth/.well-known/jwks.json`             | `CONVEX_SITE_URL` (auto)   | JWT verification                      |
| `/auth/.well-known/webauthn`              | RP ID host (auto on Convex)| Multi-origin passkeys                 |
| `/.well-known/apple-app-site-association` | `SITE_URL` (frontend)      | Native iOS passkeys + Universal Links |
| `/.well-known/assetlinks.json`            | `SITE_URL` (frontend)      | Native Android passkeys + App Links   |
| `/.well-known/change-password`            | `SITE_URL` (frontend)      | Password manager deep-links           |
| `/.well-known/security.txt`               | `SITE_URL` (frontend)      | Security researcher contact (RFC 9116)|

The first three are wired automatically when the auth component is mounted.
They are served under the same prefix as `auth.http()`, which defaults to
`/auth`.
The last four are framework-agnostic generators apps adapt into their own
route handlers.

## Auto-mounted (Convex backend)

These ship with the library. Setting `WEBAUTHN_ALT_ORIGINS` or `SECONDARY_URL`
enables the WebAuthn endpoint; the others are always on.

```bash
curl https://<your-convex-site>/auth/.well-known/openid-configuration
curl https://<your-convex-site>/auth/.well-known/jwks.json
curl https://<your-convex-site>/auth/.well-known/webauthn
```

## Self-hosted (frontend)

Each helper reads convention env vars or accepts explicit overrides, and
returns `null` when nothing is configured (so the route can serve 404).

### iOS — `apple-app-site-association`

```ts
// SvelteKit: src/routes/.well-known/apple-app-site-association/+server.ts
import { generateAppleAppSiteAssociation } from "@robelest/convex-auth/server";

export const GET = () => {
  const r = generateAppleAppSiteAssociation();
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

Configure with `IOS_APP_IDS` (comma-separated `TEAMID.bundle.id` entries)
and optional `IOS_APPLINK_PATHS` (comma-separated path patterns, defaults to
`/auth/*,/callback/*`).

> ⚠️ The path has **no `.json` extension**. Apple's CDN fetches it without
> one. Do not redirect — Apple will not follow redirects for this file.

### Android — `assetlinks.json`

```ts
import { generateAssetLinks } from "@robelest/convex-auth/server";
```

Configure with `ANDROID_APP_LINKS` in the format
`package1:FP1;package2:FP2` where each fingerprint is a colon-separated
SHA-256 hex string. Find your fingerprint with `gradlew signingReport` (debug)
or in the Play Console (release).

The output is a top-level JSON array (not an object) — that's the spec.

### Multi-origin passkeys — `webauthn`

```ts
import { generateWebAuthnConfig } from "@robelest/convex-auth/server";
```

Configure with `WEBAUTHN_ALT_ORIGINS` (comma-separated origins). Falls back
to `SECONDARY_URL` if set. Lets a passkey registered at `app.example.com`
work on `staging.example.com` or browser extensions.

### Password managers — `change-password`

```ts
import { generateChangePasswordRedirect } from "@robelest/convex-auth/server";
```

Configure with `CHANGE_PASSWORD_URL` (the in-app settings page URL).
Returns a 302 redirect — supported by 1Password, iCloud Keychain, Bitwarden,
and Chrome's built-in password manager.

The settings page should call the password provider's `change` flow:

```ts
await auth.signIn("password", {
  email,
  currentPassword,
  newPassword,
  flow: "change",
});
```

See [Password provider](/getting-started/providers#password) for details.

### Security researchers — `security.txt`

```ts
import { generateSecurityTxt } from "@robelest/convex-auth/server";
```

Configure with `SECURITY_CONTACT` (e.g., `mailto:security@example.com` or
`https://example.com/security`). Optional: `SECURITY_TXT_EXPIRES_DAYS`
(default 365).

## Common pitfalls

- **AASA must not redirect.** The Apple CDN fetches it once on app
  install/update and rejects redirects. Serve it directly at the path.
- **AASA has no extension.** The path is exactly `/.well-known/apple-app-site-association`
  with no `.json` suffix.
- **`Content-Type` matters.** AASA must be `application/json`,
  `assetlinks.json` must be `application/json`, and `security.txt` must be
  `text/plain`. The generators set these headers — preserve them when
  adapting.
- **Apple caches AASA aggressively** (~24h). For development, append
  `?mode=developer` to the Associated Domain entitlement (iOS 17.4+) to
  bypass caching and AASA verification.
- **RP ID must match the AASA host.** If your WebAuthn RP ID is
  `app.example.com`, AASA must be served at `https://app.example.com/.well-known/apple-app-site-association`.
- **`assetlinks.json` is a top-level array.** Common mistake to wrap in an
  object — the generator handles this.

## Related

- [Native apps guide](/guides/native-apps) — full setup for iOS + Android passkeys
- [Production checklist](/guides/production) — ensure these endpoints are live
- [Environment variables](/getting-started/environment) — all env vars
