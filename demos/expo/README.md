# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with
[`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   pnpm install
   ```

2. Start the app

   ```bash
   pnpm expo start
   ```

## Native passkeys (iOS + Android)

Native passkeys require a paired host that serves Apple's AASA file and
Google's `assetlinks.json`. The companion `demos/svelte` app does this when
the following env vars are set on its host:

```bash
# matches your Apple Team ID + iOS bundle identifier
IOS_APP_IDS="ABC123DEF.com.example.app"

# Android package name and SHA-256 cert fingerprint (from `gradlew signingReport`)
ANDROID_APP_LINKS="com.example.app:AA:BB:CC:DD:..."

# Same as the WebAuthn RP ID — drives Associated Domains in app.config.js
SITE_URL="https://your-domain.example"
```

The Expo config in `app.config.js` reads `SITE_URL` and wires it into both
iOS Associated Domains (`webcredentials:<host>`) and Android intent filters.
After changing env, run `pnpm expo prebuild --clean` and rebuild the native app.

For local testing without hosting AASA, append `?mode=developer` to the
Associated Domain entry (iOS 17.4+ developer mode).

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app
  development with Expo

You can start developing by editing the files inside the **app** directory. This
project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and
create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following
resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into
  advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a
  step-by-step tutorial where you'll create a project that runs on Android, iOS,
  and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform
  and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask
  questions.
