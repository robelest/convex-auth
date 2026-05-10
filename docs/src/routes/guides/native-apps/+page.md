---
title: Native apps (iOS + Android)
description: Set up native passkeys, Associated Domains, and App Links for Expo / React Native.
---

<svelte:head>

  <title>Native apps - convex-auth</title>
</svelte:head>

# Native apps (iOS + Android)

Native passkeys on iOS and Android only work when the app declares an
**Associated Domain** (iOS) or **App Link** (Android) for your WebAuthn RP
ID, and that domain serves the matching `.well-known` files. This guide
walks through both sides for an Expo app paired with a SvelteKit (or any
other) frontend.

## What you'll wire up

| Side       | What                                            |
| ---------- | ----------------------------------------------- |
| Native app | iOS Associated Domains + Android intent filters |
| Frontend   | `apple-app-site-association` + `assetlinks.json`|

## iOS

### 1. Get your Team ID and Bundle ID

- **Team ID**: Apple Developer → Membership → Team ID (10-character string).
- **Bundle ID**: From `app.config.js` / `app.json` → `ios.bundleIdentifier`.
  Combined as `TEAMID.com.example.app`.

### 2. Add the Associated Domain to your Expo config

```js
// app.config.js
const passkeyDomain = process.env.SITE_URL
  ? new URL(process.env.SITE_URL).hostname
  : null;

module.exports = {
  expo: {
    ios: {
      bundleIdentifier: "com.example.app",
      ...(passkeyDomain
        ? { associatedDomains: [`webcredentials:${passkeyDomain}`] }
        : {}),
    },
  },
};
```

For local development, append `?mode=developer` to bypass AASA verification
(iOS 17.4+):

```js
associatedDomains: [`webcredentials:${passkeyDomain}?mode=developer`],
```

### 3. Serve AASA from the frontend

Set `IOS_APP_IDS` on the SvelteKit (or other) host:

```bash
IOS_APP_IDS="ABC123DEF.com.example.app"
```

Then add the route:

```ts
// src/routes/.well-known/apple-app-site-association/+server.ts
import { generateAppleAppSiteAssociation } from "@robelest/convex-auth/server";

export const GET = () => {
  const r = generateAppleAppSiteAssociation();
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

### 4. Rebuild and verify

```bash
pnpm expo prebuild --clean
pnpm expo run:ios --device
```

Verify Apple's CDN sees the file:

```bash
curl https://app-site-association.cdn-apple.com/a/v1/<your-domain>
```

In iOS Settings, search for your app — Associated Domains should list your
host. Pressing the passkey button should now show the native iOS sheet.

## Android

### 1. Get your SHA-256 fingerprint

For debug builds:

```bash
cd android && ./gradlew signingReport
```

For release builds, use the fingerprint from Google Play Console → Setup →
App signing.

### 2. Add intent filters to Expo config

```js
// app.config.js
module.exports = {
  expo: {
    android: {
      package: "com.example.app",
      ...(passkeyDomain
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: passkeyDomain }],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
  },
};
```

### 3. Serve `assetlinks.json` from the frontend

Set `ANDROID_APP_LINKS`:

```bash
ANDROID_APP_LINKS="com.example.app:AA:BB:CC:DD:EE:FF:..."
```

Then add the route:

```ts
// src/routes/.well-known/assetlinks.json/+server.ts
import { generateAssetLinks } from "@robelest/convex-auth/server";

export const GET = () => {
  const r = generateAssetLinks();
  if (r === null) return new Response(null, { status: 404 });
  return new Response(r.body, { status: r.status, headers: r.headers });
};
```

### 4. Verify

Use Google's validator:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://<host>&relation=delegate_permission/common.get_login_creds
```

Trigger Credential Manager from a real Android device — the passkey sheet
should appear.

## Choosing the RP ID

Your WebAuthn RP ID must match the AASA / `assetlinks.json` host. The
convex-auth `passkey()` provider derives the RP ID from `SITE_URL` by
default:

| `SITE_URL`               | RP ID         |
| ------------------------ | ------------- |
| `https://app.example.com`| `app.example.com` |
| `http://localhost:5173`  | `localhost`   |

You can override with `passkey({ rpId: "example.com" })` if you want passkeys
to work across subdomains (the AASA / `assetlinks.json` must then live at
`example.com`).

## Troubleshooting

- **Native sheet doesn't appear, error like "Passkey sign-in failed"**:
  Most likely the Associated Domain entitlement is missing or AASA isn't
  reachable. Run `curl https://app-site-association.cdn-apple.com/a/v1/<host>`.
- **"webauthn: not supported"**: Check `Passkey.isSupported()` in the
  `react-native-passkey` library — needs iOS 16+ / Android 14+ / Play Services.
- **Counter validation failures**: Test on a fresh device — emulators have
  spotty Credential Manager support.

## Related

- [.well-known endpoints reference](/reference/well-known)
- [Production checklist](/guides/production)
