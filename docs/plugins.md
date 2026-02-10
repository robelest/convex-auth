# Plugins Roadmap

This document tracks the plugin roadmap for `@convex-dev/auth` as a Convex-native component.

## Scope Right Now

Current focus is intentionally small:

- Ship the core componentized auth runtime with a clean framework-agnostic API.
- Implement the highest-priority plugins needed for production use:
  - `passkey`
  - `api-key`
  - `organization` (Convex-native org/team/member/invite model)

Everything else is a post-ship roadmap item.

## Design Principles

- Framework-agnostic first (`server` + pure TypeScript `client` contracts).
- Convex-native storage and function boundaries.
- Plugins should be composable and minimally coupled.
- Prefer stable, explicit interfaces over implicit framework behavior.

## Plugin Status

| Plugin | Priority | Status | Notes |
| --- | --- | --- | --- |
| passkey | P0 | planned | Highest priority; implement via Node actions where required. |
| api-key | P0 | planned | Core machine-to-machine auth support. |
| organization | P0 | planned | Treated as core Convex model surface (tables + Auth class methods). |
| admin | P1 | backlog | Depends on organization role model. |
| bearer | P1 | backlog | Can layer on top of api-key and session primitives. |
| one-time-token | P1 | backlog | Useful for secure single-use flows. |
| 2fa/totp | P1 | backlog | After passkey/api-key/org are stable. |
| username | P2 | backlog | Likely profile/identifier extension, may not need separate plugin. |
| one-tap | P2 | backlog | UX-focused extension. |
| generic-oauth | P2 | existing core | Already supported in core auth provider flow. |
| oidc-provider | P3 | backlog | Advanced provider-side capability. |
| oauth-provider | P3 | backlog | Advanced provider-side capability. |
| mcp | P3 | backlog | Future integration target. |
| sso (saml) | P4 | deferred | Not in immediate delivery scope. |
| scim | P4 | deferred | Not in immediate delivery scope. |
| device-authorization | P4 | deferred | Not in immediate delivery scope. |

## Current Release Sequence

1. Finalize framework-agnostic core API (client + server contracts).
2. Ship `organization` model and methods as Convex-native core surface.
3. Ship `passkey` plugin.
4. Ship `api-key` plugin.
5. Revisit backlog plugins after core + P0 plugins are stable.

## Provider-Agnostic Adapters

The existing email/phone provider pattern remains the baseline for plugin adapters:

- `sendVerificationRequest(...)`
- `generateVerificationToken?()`
- `normalizeIdentifier?()`
- `authorize?()`

This keeps provider integration (Resend, Twilio, custom APIs) framework-agnostic and runtime-focused.

## Notes

- Better Auth is used as inspiration for plugin surface area, but implementation here is Convex-native.
- Not every Better Auth "plugin" maps 1:1 to a configurable plugin in this repo; some features belong in core tables/functions.
