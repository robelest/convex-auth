# Robel Convex Auth integration report

Practical integration notes from wiring `@robelest/convex-auth` into a fresh Vite + React 19 + Convex 1.25 app (codename Forge). Intended for the upstream maintainer as a bug and feedback report. Written after reaching a working GitHub sign-in flow on April 17, 2026.

## Versions in use

| Package                 | Version                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `@robelest/convex-auth` | `0.0.4-preview.27`                                         |
| `convex`                | `^1.25.0`                                                  |
| `react`                 | `^19.1.0`                                                  |
| `react-router`          | `^7.5.1`                                                   |
| Vite                    | 5.x                                                        |
| Bundler runtime         | Convex (V8) + Node actions                                 |
| Upstream docs           | `https://auth.estifanos.com/getting-started/installation/` |
| Upstream skill used     | `.cursor/skills/robel-auth/SKILL.md`                       |

## Stack summary

- Single-page React app served by Vite in dev, later by `@convex-dev/static-hosting` in prod.
- Convex backend with `@robelest/convex-auth` registered as a component in `convex/convex.config.ts`.
- Single OAuth provider: GitHub, via `github({ clientId, clientSecret })`.
- No SSO, no email, no password, no passkey. Just GitHub + an app-level allowlist (`@convex.dev`).
- React client uses `client({ convex, api })` from `@robelest/convex-auth/browser`.
- Email-based access control gate layered on top of Robel.

## Headline findings

1. Sign-in works once all four problems below are fixed, and the developer experience after that is clean.
2. Two genuine upstream bugs were hit in `preview.27`, both reproducible. One was patched locally, the other was the cause of a continuous network loop.
3. Two "configuration" gotchas cost real time because they are not explicit in the docs or the CLI output.
4. The docs site drifts from the published npm tarball. The `SKILL.md` we maintained locally called this out and saved time.

## Timeline

Each row lists the symptom first, then the root cause, then the fix actually used in the repo.

### 1. Install path drift between docs and published tarball

| When           | What happened                                                                                                                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install day 1  | Copied `github({...})` from `auth.estifanos.com/getting-started/providers/github`.                                                                                                                                                                                                                                                                                       |
| Failure        | `Module not found: Can't resolve '@robelest/convex-auth/providers/github'`.                                                                                                                                                                                                                                                                                              |
| Investigation  | `ls node_modules/@robelest/convex-auth/dist/providers/` showed `OAuth.js`, `Password.js`, etc., PascalCase classes and a generic `OAuth()` factory. No lowercase first-party `github.js`.                                                                                                                                                                                |
| Fix            | Checked `SKILL.md` section "Published package reality check". The skill explicitly said docs describe APIs ahead of the released tarball. Wrapped GitHub as `OAuth("github", { provider: github(...) from arctic, profile: ... })` initially. Later upgraded to `preview.27`+ and switched to the lowercase `github({ clientId, clientSecret })` factory that does ship. |
| Recommendation | Add a banner to the provider pages showing the minimum npm version that has the lowercase first-party factories. Either that or publish the docs site from the same ref as the npm tarball.                                                                                                                                                                              |

### 2. Missing CLI wizard feedback on required env vars

| When                  | What happened                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First sign-in attempt | `npx convex dev` ran fine. OAuth redirect came back. `auth:store` mutation threw `Uncaught ConvexError: {"code":"MISSING_ENV_VAR","message":"Missing environment variable JWT_PRIVATE_KEY"}`.                                                                                                                                                     |
| Cause                 | `JWT_PRIVATE_KEY` and `JWKS` were never generated. The docs say "run the auth setup wizard", but `npx @robelest/convex-auth` in this project version either did not exist or silently exited. The README also mentions "the wizard handles key generation" without spelling out the exact subcommand that works on the installed preview tarball. |
| Fix                   | Ran the wizard manually after a few retries and `npx convex env set JWT_PRIVATE_KEY ...` / `JWKS ...` directly.                                                                                                                                                                                                                                   |
| Recommendation        | Throw a clearer error at `npx convex dev` start-up: `"@robelest/convex-auth requires JWT_PRIVATE_KEY. Run: npx @robelest/convex-auth generate-keys"`. Bonus: print the exact command needed to set them in Convex env.                                                                                                                            |

### 3. `api` option shape vs. actual exported function references

| When                     | What happened                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wiring `src/lib/auth.ts` | Per the docs, `client({ convex, api: api.auth })`. TypeScript error `TS2741: Property 'store' is missing in type { signIn, signOut } but required in type AuthApiRefs`.                                                                                                                                                                               |
| Cause                    | `createAuth` registers `store` as an `internalMutation`, not a public one. So `api.auth` only carries `signIn` + `signOut`; `store` lives on `internal.auth`. The `AuthApiRefs` type in `@robelest/convex-auth/browser` declares `store` as a public ref. Runtime is fine (the component calls `internal.auth.store` itself), but the types disagree. |
| Fix                      | ```ts                                                                                                                                                                                                                                                                                                                                                 |

const authApi = {
signIn: api.auth.signIn,
signOut: api.auth.signOut,
store: internal.auth.store,
} as unknown as AuthApiRefs;
export const auth = client({ convex, api: authApi });

````|
| Recommendation | Either widen `AuthApiRefs.store` to accept internal function refs, or export a helper that composes the right shape from `api` + `internal` (e.g. `buildAuthApi(api, internal)`). Current shape forces a type cast in every app. |

### 4. GitHub OAuth token exchange throws `Missing or invalid 'expires_in' field`

This was the first "real" bug and the one I would most want to see fixed upstream.

| When | What happened |
|---|---|
| First successful OAuth redirect | `auth:signIn` action threw `OAUTH_PROVIDER_ERROR: Unexpected error during token exchange: Missing or invalid 'expires_in' field`. GitHub OAuth sign-in was impossible. |
| Cause | `dist/server/oauth/factory.js` inside `normalizeTokens()` calls `tokens.accessTokenExpiresAt()` unconditionally. That method is arctic's helper, and arctic **throws** when the token response omits `expires_in`. GitHub OAuth Apps do not return `expires_in` — access tokens are non-expiring by design on classic OAuth Apps. So GitHub + `preview.27` is a guaranteed throw on every successful auth. |
| Reproduce | Install `@robelest/convex-auth@0.0.4-preview.27`, enable `github({...})`, attempt sign-in. Throws before writing session. |
| Attempted upgrade | Bumped to `preview.28` and `preview.29`. Both published tarballs list `"dependencies": { "some-internal-pkg": "workspace:*" }`, which npm refuses to resolve outside the Robel monorepo. Neither release installs from npm. |
| Fix used in Forge | `patch-package` + a six-line diff that wraps the call in a try/catch. File: `patches/@robelest+convex-auth+0.0.4-preview.27.patch`. `postinstall: patch-package` in `package.json` keeps the patch applied across fresh installs. The patch preserves the existing semantics for providers that do return `expires_in` (Google, Apple). |
| Patch snippet | ```js
let accessTokenExpiresAt;
try {
  if (typeof tokens.accessTokenExpiresAt === "function") {
    accessTokenExpiresAt = tokens.accessTokenExpiresAt();
  } else if (typeof raw.expires_in === "number") {
    accessTokenExpiresAt = new Date(Date.now() + raw.expires_in * 1e3);
  }
} catch {
  accessTokenExpiresAt = typeof raw.expires_in === "number"
    ? new Date(Date.now() + raw.expires_in * 1e3)
    : void 0;
}
``` |
| Recommendation | In `normalizeTokens`, guard the `tokens.accessTokenExpiresAt()` call. GitHub OAuth Apps are the single most common provider most apps wire first, so the first sign-in attempt in a fresh integration hits this error today. Also: fix the `workspace:*` dependency that ships in `preview.28`/`.29` so the error can be resolved by a plain `npm install @robelest/convex-auth@latest`. |

### 5. Convex rejects every JWT until `convex/auth.config.ts` is added

| When | What happened |
|---|---|
| After patch 4 | OAuth exchange succeeded, session row was written. Browser immediately hit `Failed to authenticate: "No auth provider found matching the given token (no providers configured). Check convex/auth.config.ts."`. |
| Cause | Convex server needs an `auth.config.ts` that names a trusted JWT issuer for every token. Robel signs with `iss = process.env.CONVEX_SITE_URL` and `aud = "convex"` (source: `dist/server/tokens.js`). Without a matching provider, Convex rejects the token before handing it to the query. |
| Fix | ```ts
// convex/auth.config.ts
export default {
  providers: [
    { domain: process.env.CONVEX_SITE_URL!, applicationID: "convex" },
  ],
};
``` |
| Gotcha | `CONVEX_SITE_URL` is auto-populated by Convex, so the file does not need any user env vars. This is non-obvious. The skill mentioned it; the docs site does not yet. |
| Recommendation | Either have `createAuth` emit a compile-time warning if `convex/auth.config.ts` is missing / does not reference `CONVEX_SITE_URL`, or ship a `setup` wizard step that scaffolds the file. Better: have the component HTTP mount or `createAuth` log once at dev-server boot if the config is absent. |

### 6. Silent `auth:signIn` / `auth:store refreshSession` loop on protected pages with denied sessions

Highest-impact bug after #4. The symptom is cheap traffic; the cause is a design issue worth flagging.

| When | What happened |
|---|---|
| After adding an app-level `@convex.dev` allowlist | User signs in with GitHub, app redirects to `/auth/denied`, and the Convex dashboard logs `auth:signIn` + `auth:store type: refreshSession` pairs every ~500 ms **indefinitely**. No errors, just continuous traffic. |
| Cause | On `/auth/denied` the Robel client still has a valid token; nothing ever clears it. The Convex WebSocket schedules token refetches against the token's `exp`; the default `jwt.durationMs` in Robel's `tokens.js` is 1 hour, so that is not the loop source. The loop actually comes from Convex's own auth state machine entering `waitingForServerConfirmationOfFreshToken`, the server "confirming" via the next query, and the client immediately asking for a fresh token again. Net effect: ~2 refresh calls per second. |
| Fix used | Added a one-shot `useAutoSignOut()` hook that calls `auth.signOut()` exactly once when `access.authenticated && !access.allowed`. That invalidates the session on the Convex side, the token goes null on the client, and the loop ends within one round trip. The denial page latches the user's email into `useState` so the UI survives the unauthenticated re-render. |
| Root-cause observation | Once a session is **authenticated but the app does not want to run queries** (the "authenticated but denied" case), there is no first-party way to stop the Convex client from periodically re-authing. Calling `signOut` is the only lever. This is fine, but it is not documented as the recommended pattern for allowlist-style access gates. |
| Recommendation | Document the "authenticated but app-level denied" pattern in `auth.estifanos.com/guides/`. Suggest calling `signOut()` as soon as the app-level gate rejects a session. Optional: add an `auth.pauseRefresh()` / `auth.resumeRefresh()` pair on the browser client for apps that want to keep the session alive but suspend automatic refetches. |

### 7. `ctx.auth.getUserIdentity()` does not expose email / name / picture

| When | What happened |
|---|---|
| After everything else worked | Sign-in completed, the app-level allowlist check returned `allowed: false` for **every** GitHub account, including ones with a valid `@convex.dev` primary email. |
| Cause | Robel's signed JWT only contains `sub`, `iss`, `aud`, `iat`, `exp`, `jti`. Email, name, and `image` live in the auth component's `User` table, not in the token. `ctx.auth.getUserIdentity().email` is therefore always `undefined`, and `isAllowedEmail(undefined)` rejected everyone. |
| Fix | Switched the access check from `ctx.auth.getUserIdentity().email` to `await auth.user.viewer(ctx)` in every query and mutation that needs identity data. `viewer` reads the Robel component's `User` row and exposes `email`, `name`, `image`. |
| Observation | Many Convex integrations (Clerk, Auth0) do put email into the token so `ctx.auth.getUserIdentity().email` "just works" there. Copy-pasting that pattern to Robel silently fails. |
| Recommendation | Do one of: (a) include `email`, `name`, `picture` as optional claims in the JWT when the provider returns them; or (b) document the gap explicitly on `auth.estifanos.com/api/user/` with a warning box stating that `ctx.auth.getUserIdentity()` returns only `sub`-derived fields and that app code must call `auth.user.viewer(ctx)` for profile data. A short "migrating from Clerk/Auth0" note would save a lot of first-day confusion. |

## What worked out of the box

Not everything is a bug report. These landed cleanly on the first try:

- `defineApp().use(auth)` in `convex/convex.config.ts`.
- Component-owned HTTP mounting for OAuth callbacks + JWKS endpoints.
- Subscribing to browser state with `auth.onChange` (fits `useSyncExternalStore` perfectly).
- Server helpers like `auth.user.viewer(ctx)` returning a typed row from the component's `User` table.
- GitHub OAuth redirect itself, including state + PKCE handling.
- The Convex deployment URL being the correct `Authorization callback URL` for the GitHub OAuth App.
- `auth.signOut()` cleanly invalidating the session on both server and client in one call.
- `components.auth.public.*` references surfacing clean types.

## Skill vs. docs

Keeping a local `SKILL.md` for Robel was the single highest-leverage decision we made. A few specific points where it beat the public docs:

- Called out that the docs describe APIs ahead of the published tarball.
- Gave explicit commands to introspect `node_modules/@robelest/convex-auth/dist/providers/` before trusting any import path.
- Flagged that `client({ convex, api })` requires the `api` option in SPA mode (missing it only fails at first `signIn`).
- Listed the exact env vars that the component reads at runtime (`JWT_PRIVATE_KEY`, `JWKS`, `CONVEX_SITE_URL`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `SITE_URL`).
- Documented the multi-access pattern (`auth.ctx()`, `auth.context(ctx)`, `auth.request.context(ctx, request)`).

These all belong on `auth.estifanos.com` directly, either as an "Integration gotchas" page or inline in the relevant sections.

## Patches applied in Forge

Single file: `patches/@robelest+convex-auth+0.0.4-preview.27.patch`.

```diff
--- a/node_modules/@robelest/convex-auth/dist/server/oauth/factory.js
+++ b/node_modules/@robelest/convex-auth/dist/server/oauth/factory.js
 function normalizeTokens(tokens) {
   const raw = tokens.data;
   const rawScopes = typeof raw.scope === "string" ? raw.scope : void 0;
+  let accessTokenExpiresAt;
+  try {
+    if (typeof tokens.accessTokenExpiresAt === "function") {
+      accessTokenExpiresAt = tokens.accessTokenExpiresAt();
+    } else if (typeof raw.expires_in === "number") {
+      accessTokenExpiresAt = new Date(Date.now() + raw.expires_in * 1e3);
+    }
+  } catch {
+    accessTokenExpiresAt = typeof raw.expires_in === "number"
+      ? new Date(Date.now() + raw.expires_in * 1e3)
+      : void 0;
+  }
   return {
     accessToken: typeof raw.access_token === "string" ? raw.access_token : void 0,
     refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : void 0,
     idToken: typeof raw.id_token === "string" ? raw.id_token : void 0,
-    accessTokenExpiresAt: typeof tokens.accessTokenExpiresAt === "function"
-      ? tokens.accessTokenExpiresAt()
-      : typeof raw.expires_in === "number"
-        ? new Date(Date.now() + raw.expires_in * 1e3)
-        : void 0,
+    accessTokenExpiresAt,
     scopes: rawScopes
       ? rawScopes.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
       : void 0,
     raw: tokens.data,
   };
 }
````

One dev dependency added (`patch-package`) and a `postinstall` script to re-apply on every install.

## Suggested upstream fixes

Highest-impact first:

1. **Fix `normalizeTokens` for providers without `expires_in`.** This is the only bug today that blocks a plain GitHub integration from succeeding. Ship the guarded version in the next preview release.
2. **Unblock npm installs of `preview.28` and later.** The current `workspace:*` dependency makes the upgrade path unavailable to consumers outside the Robel monorepo.
3. **Widen `AuthApiRefs.store` to accept internal refs, or export a composer helper.** Removes a mandatory `as unknown as AuthApiRefs` cast in every app.
4. **Document the "authenticated but app-level denied" pattern.** Recommend calling `signOut()` as the clearing mechanism. Optional: `auth.pauseRefresh()` primitive.
5. **Document that `ctx.auth.getUserIdentity()` is `sub`-only.** Add a warning box. Point developers at `auth.user.viewer(ctx)` for profile data.
6. **Scaffold `convex/auth.config.ts`** in the CLI wizard, or error at boot if it is missing.
7. **Clearer startup error when `JWT_PRIVATE_KEY` is absent.** Include the exact command to generate and set it.

## Files that were changed in Forge to make this work

For reference if you want to mirror-check any of the decisions:

- `convex/convex.config.ts` — register the component.
- `convex/auth.ts` — `createAuth(components.auth, { providers: [github(...)] })`.
- `convex/auth.config.ts` — trust `process.env.CONVEX_SITE_URL` with `aud: "convex"`.
- `convex/http.ts` — app routes.
- `convex/users.ts` — reads email via `auth.user.viewer(ctx)` everywhere; never trusts `ctx.auth.getUserIdentity().email`.
- `convex/lib/access.ts` — pure `isAllowedEmail` / `roleForEmail` helpers.
- `src/lib/auth.ts` — the `AuthApiRefs` cast.
- `src/hooks/useAuth.ts` — `useSyncExternalStore` over `auth.onChange`.
- `src/hooks/useEnsureAppUser.ts` — two-stage probe: `users.access` first, then `users.me`.
- `src/hooks/useAutoSignOut.ts` — kills the denial-page refresh storm.
- `src/pages/AccessDenied.tsx` — latches email to `useState` so the denial page survives the post-signOut render.
- `patches/@robelest+convex-auth+0.0.4-preview.27.patch` — the `normalizeTokens` guard.
- `package.json` — `patch-package` dev dep + `postinstall` script.

## Net outcome

Phase 1 is green:

- GitHub OAuth sign-in works for `@convex.dev` accounts.
- Non-`@convex.dev` accounts land on `/auth/denied`, see their email, get signed out silently, and can retry.
- Convex dashboard logs are quiet during an authenticated session. No refresh storm.
- TypeScript is strict; ESLint passes; `convex-doctor` scores 90 (all remaining warnings are triaged false positives).

Total integration time once the six fixes above were understood: roughly an evening. Time spent diagnosing the six fixes: substantially more. Most of that would be recovered for future integrators by the recommended changes above.

Happy to share the Forge repo if it helps reproduce anything.
