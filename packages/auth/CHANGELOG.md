# Changelog

## 0.0.4-preview.9

- Fix SSR issuer validation in `server()` so `url` stays the Convex API URL
  (`*.convex.cloud`) while tokens issued by the matching `*.convex.site`
  deployment are accepted by default.
- Add `accepted_issuers` to `server()` options for explicit issuer override in
  `refresh()` and `verify()` flows.
- Add regression coverage for cloud/site issuer compatibility, unrelated issuer
  rejection, and explicit issuer override behavior.
- Clarify SSR docs: `url` is the Convex deployment URL, issuer validation rules,
  and a minimal SvelteKit proxy-mode setup.
- Harden proxy refresh handling by keeping a still-valid access token when the
  refresh-token cookie is temporarily missing, and by preserving rejection for
  invalid issuers.
- Retry transient proxy refresh failures client-side before falling back to
  signed-out state.
- Improve same-origin detection behind reverse proxies by honoring
  `x-forwarded-proto` in SSR helper checks.

Migration note:
- Most SSR proxy-mode apps need no changes after upgrading.
- If you use a custom JWT issuer, set `accepted_issuers` explicitly in
  `server({...})`.

## 0.0.4-preview.8

- Breaking preview update: normalized auth action references to
  `auth/session:start`, `auth/session:stop`, and `auth/store:run`; removed
  legacy aliases.
- Breaking preview update: renamed auth component tables to PascalCase
  identifiers (for example `User`, `Session`, `Account`, `RefreshToken`) and
  propagated the new names through component/server types and queries.
- Breaking preview update: provider API continues to use `OAuth(...)` and
  class-based providers (`new Password()`, `new Passkey()`, `new Totp()`,
  `new Device()`, `new Anonymous()`) without deprecated default-export
  provider helpers.

## 0.0.4-preview.7

- Isolate auth cookies by namespace in SSR server helpers. A deterministic
  deployment-based namespace is now used by default, and apps can override it
  with `cookieNamespace` to prevent localhost cross-app cookie collisions.
- Add issuer compatibility guards in token verification/refresh paths to clear
  foreign deployment tokens instead of treating them as authenticated sessions.
- Harden refresh handling for malformed refresh-token cookie values and add
  security regressions for namespace isolation and issuer mismatch behavior.

## 0.0.4-preview.6

- Harden proxy-mode client handshake confirmation by keeping in-flight handshakes
  pending across transient Convex `onAuthChange(false)` callbacks, instead of
  immediately rejecting with `AUTH_HANDSHAKE_REJECTED`.
- Add a unique JWT `jti` claim to issued access tokens so rapid refresh/sign-in
  cycles always produce distinct tokens for Convex auth confirmation.
- Add regression coverage for handshake race conditions and a ledger-style
  sign-up + invite-accept flow in proxy mode.

## 0.0.4-preview.5

- Breaking preview update: `isAuthenticated` on the client now represents
  server-confirmed auth state instead of local token presence. Sign-in flows now
  wait for Convex auth confirmation and throw structured handshake errors on
  rejection/timeout.
- Invite APIs now support token-first acceptance flows: create returns raw invite
  token, acceptance can be performed by token, invite expiration is enforced, and
  group membership is ensured atomically during acceptance.
- Breaking preview API update: removed `auth.invite.getByToken(...)` and
  `auth.invite.acceptByToken(...)`. Use `auth.invite.token.get(...)` and
  `auth.invite.token.accept(...)` instead.
- Token invite acceptance now requires matching invite email, but no longer
  requires the accepting user email to already be verified.
- Server refresh/proxy behavior is more resilient: transient OAuth code exchange
  and token refresh failures preserve active sessions instead of eagerly clearing
  cookies; terminal failures still clear verifier state.

## 0.0.91

- Fix proxy-mode client token wiring so `convex.setAuth(fetchAccessToken)` is
  re-synced after token updates (sign-in, TOTP, passkey, device), enabling
  authenticated direct Convex queries/mutations after SSR/proxy sign-in.
- Preserve existing auth cookies on OAuth code exchange errors and non-refresh
  proxy sign-in errors instead of force-clearing active sessions.
- Improve auth hardening: validate missing PKCE verifier cookies during OAuth
  callbacks, make localhost detection robust without requiring explicit ports,
  avoid cross-origin cookie mutation during server-side refresh handling, and
  add cycle guards to refresh-token subtree invalidation.
- Improve client resilience in browsers by handling storage read/write failures
  gracefully, deduplicating global storage listeners, and serializing manual
  refresh locks with a safer mutex fallback in environments without Web Locks.

## 0.0.90

- fix negative `shouldHandleCode` logic for client

## 0.0.89

- Accept `shouldHandleCode` as a boolean or function, and support async function
  in middleware.

## 0.0.88

- Add new cli options `--allow-dirty-git-state` and `--web-server-url <url>` to
  enable running non-interactively.

## 0.0.87

- Add missing `shouldHandleCode` prop to Next.js server provider

## 0.0.86

- Fix RN enviornment checks for Expo 53+ for real

## 0.0.85

- Fix RN enviornment checks for Expo 53+

## 0.0.84

- Accept `shouldHandleCode` in ConvexAuthProvider

## 0.0.83

- Fix auth error messages not propagating from backend to client for Next.js

## 0.0.82

- Add `shouldHandleCode` prop to React/Next.js clients and Next.js middleware to
  allow for custom code handling.

## 0.0.81

- Retry token fetch on network errors
- Update the CLI script to work in non-interactive terminals

## 0.0.80

- Fix a race when quickly refreshing a page or using redirects that refresh the
  page.

## 0.0.79

- Expose function reference types `SignInAction` and `SignOutAction` for the
  benefit of other client implementations (Svelte, Solid, etc.). As with all
  APIs in the library these are not stable and may change until this library
  reaches 1.0.

- Add a platform check in the recommended `ConvexAuthProvider` use for React
  Native in docs.

- Fix auth refresh silent failure for React Native. This has been a slippery
  issue, if you use Convex Auth in a React Native app please let us know if this
  fixes for you.

## 0.0.78

- Add support for
  [custom OAuth callback and sign-in URLs](https://labs.convex.dev/auth/advanced#custom-callback-and-sign-in-urls)

- Next.js middleware function `isAuthenticated` fails more loudly; previously it
  returned false in the case of a Convex backend that didn't expose an endpoint
  called `auth:isAuthenticated`, now it throws an error. This should help people
  with the migration required for 0.0.76.

## 0.0.77

- Fix syntax of an import to work with convex-test.

## 0.0.76

- BREAKING: A change in the logic for isAuthenticated for Next.js: it now
  involves a server-side check. Update your auth.ts file by adding a new
  `isAuthenticated` endpoint to the list of exported Convex functions, like

  ```
  export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth(...
  ```

  If you're not using Next.js, you should still add this named export as it's
  the new suggested set of publicly exposed endpoints, but nothing should break
  if you don't.

- Potentially breaking: For NextJS, switched to `path-to-regexp` 6.3.0 to avoid
  ReDoS vulnerability. That version, while protected from the vulnerability, has
  less expressive RegEx pattern support. If you are using `createRouteMatcher`
  in middleware, it might not match some patterns that were previously available
  in the 0.7.x series. See the docs for supported patterns:
  https://www.npmjs.com/package/path-to-regexp/v/6.3.0.
- Upgraded legacy OAuth internals to 0.37.3.
- Updated OAuth integration docs for supported providers (available at
  https://labs.convex.dev/auth/config/oauth).

## 0.0.75

- BREAKING: `convexAuthNextjsToken()` and `isAuthenticatedNextjs()` now return
  promises so must be `await`ed.
- Support for Next.js 15.
- Update convex peer dependency to ^1.17.0

## 0.0.74

- Fix to header propagation in Next.js middleware
- Update Password provider to separate password requirement validation from
  custom profile information
  - **Breaking** If using Password with a custom profile to enforce password
    requirements, you must now implement `validatePasswordRequirements`

## 0.0.73

- Update implementation of refresh tokens reuse **Note:** After upgrading to
  this version, downgrading will require migrating the `authRefreshTokens` table
  to drop the `parentRefreshTokenId` field.
- Add configuration for cookie age in Next.js middleware

## 0.0.72

- Upgrade + pin legacy OAuth internals to 0.36.0 to avoid issues with mismatched types

## 0.0.71

- Fix bug with setting auth cookies on Next.js response

## 0.0.70

- Improve error handling when calling Convex auth functions from Next.js

## 0.0.69

- Add a 10s reuse window for refresh tokens

**Note:** After upgrading to this version, downgrading will require migrating
the `authRefreshTokens` table to drop the `firstUsedTime` field.

- Fix exported type for `signIn` from `convexAuth`

## 0.0.68

- [Next.js] Propagate auth cookies in middleware follow up
- Introduce `convexAuth.isAuthenticated()` and `convexAuth.getToken()` in favor
  of `isAuthenticatedNextJs()` and `convexAuthNextJsToken()` for middleware.

## 0.0.67

- [Next.js] Propagate auth cookies in middleware

## 0.0.66

- [Next.js] Match auth routes to proxy to Convex with and without trailing slash

## 0.0.65

- Add verbose logging to Next.js middleware

## 0.0.64

- Fix issue with re-entrant `fetchAccessToken` with a mutex

---

Previous versions are documented in git history.
