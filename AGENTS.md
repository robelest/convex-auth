# AGENTS.md — Coding Agent Guidelines for convex-auth

## Project Overview

Monorepo for `@robelest/convex-auth` — a Convex authentication library.
Uses **Bun** workspaces with ESM (`"type": "module"`) throughout.

| Package | Purpose |
|---|---|
| `packages/auth` | Core library (server, client, providers, CLI, Convex component) |
| `packages/test` | Vitest test suite (edge-runtime environment) |
| `packages/portal` | Admin portal SPA (SvelteKit + Tailwind v4) |
| `examples/tanstack` | Example app (TanStack Start + React) |
| `convex/` | App-level Convex backend functions |

## Build / Lint / Test Commands

All commands run from the **repo root** unless noted.

```bash
# Build the auth library (tsc x3 + esbuild CLI bundle)
bun run build

# Lint (ESLint 9 flat config, entire monorepo)
bun run lint
bun run lint:fix

# Run all tests once (CI-style)
bun run test

# Run tests in watch mode
bun run --cwd packages/test test

# Run a single test FILE
bun run --cwd packages/test test -- convex/passwords.test.ts

# Run a single test by NAME
bun run --cwd packages/test test -- -t "sign up with password"

# Generate Convex types (app + component)
bun run codegen:convex
```

### Build Sub-steps (packages/auth)

The library builds in four stages:
1. `build:version` — generates `src/server/version.ts` from `package.json`
2. `build:bin` — esbuild bundles CLI to `dist/bin.cjs`
3. `build:server` — tsc with `tsconfig.server.json` (server + providers)
4. `build:client` — tsc with `tsconfig.client.json` (client + error types)
5. `build:component` — tsc with `tsconfig.component.json` (Convex component)

## TypeScript Configuration

- **`strict: true`** in all tsconfigs — do not weaken.
- `target: "ESNext"`, `module: "ESNext"` for the auth package.
- `moduleResolution: "bundler"` in all packages.
- `declaration: true`, `declarationMap: true`, `sourceMap: true` for the auth package.
- `stripInternal: true` on server build — use `@internal` JSDoc to hide from public types.

## Code Style

### Formatting (Prettier)

Root config is minimal: `{ "proseWrap": "always" }`. Defaults apply:
- Double quotes, semicolons, 2-space indentation, default trailing commas.
- The `examples/tanstack` dir has its own Prettier config (no semis, single quotes) — do not mix.

### Imports

- **ES module imports only** (`import { X } from "module"`).
- **No `.js` extensions** on relative imports (e.g., `import { foo } from "./utils"`).
- Separate **type-only imports**: `import type { Foo } from "module"`.
- Order: third-party imports first, then relative imports.
- Re-exports: `export { X } from "module"` and `export type { X } from "module"`.

### Naming Conventions

| Element | Convention | Examples |
|---|---|---|
| Files | `camelCase.ts` | `signIn.ts`, `authCookies.ts` |
| Functions | `camelCase` | `signIn`, `parseAuthCookies` |
| Classes | `PascalCase` | `Auth` |
| Types/Interfaces | `PascalCase` | `AuthCookies`, `ConvexAuthConfig` |
| Constants | `UPPER_SNAKE_CASE` | `AUTH_ERRORS`, `JWT_STORAGE_KEY` |
| Unused params | `_` prefix | `_ctx`, `_args` |
| Private fields | `_` prefix | `_auth` |
| Provider defaults | lowercase function | `export default function password()` |

### Error Handling

The project uses a **structured error system** built on `ConvexError`:

```typescript
import { throwAuthError, isAuthError, parseAuthError } from "./errors.js";

// Throw with code (uses default message from AUTH_ERRORS map)
throwAuthError("NOT_SIGNED_IN");

// Override message or add context
throwAuthError("EMAIL_SEND_FAILED", "Custom message");
throwAuthError("MISSING_ENV_VAR", msg, { variable: name });

// Type guard
if (isAuthError(error)) { /* error is ConvexError<{code, message}> */ }

// Parse from any error shape
const parsed = parseAuthError(error); // { code, message } | null
```

- Use `throwAuthError(code)` for auth-domain errors — do NOT throw raw `ConvexError` directly.
- Use `try/catch` with `console.error` for non-fatal issues (token refresh, etc.).
- Silent `catch {}` is acceptable for cleanup operations (sign-out, storage deletion).
- Provider validation errors can use plain `throw new Error("message")`.

### Exports & Architecture Patterns

- **Factory functions over classes**: prefer `function createThing(opts)` returning an
  object over `class Thing`. This enables Convex bundler tree-shaking via
  `export const { x, y } = factory(config)`.
- **Barrel files**: use `index.ts` to re-export public API from sub-modules.
- **Named exports** for most things; **default exports** only for provider functions.
- Use `as const satisfies Record<K, V>` for exhaustive typed constant maps.
- Derive types from constants: `type Code = keyof typeof AUTH_ERRORS`.

### TypeScript Patterns

- `any` is allowed (ESLint `no-explicit-any` is off) — use it for Convex context objects
  and dynamic provider types where strict typing is impractical.
- Function overloads for different auth modes (optional vs required user).
- Generics with Convex data model: `<DataModel extends GenericDataModel>`.
- `void` prefix for fire-and-forget promises: `void refreshToken()`.
- SSR guards: `typeof window !== "undefined"`.
- Discriminated unions for state management.

### JSDoc

- Add `/** JSDoc */` with `@param`, `@returns`, `@example` on all **public API** functions.
- Use `@internal` to exclude from generated `.d.ts` files (server build uses `stripInternal`).
- Use `@module` at the top of entry-point files.

## Testing Conventions

- **Framework**: Vitest + convex-test + edge-runtime environment.
- Tests live in `packages/test/convex/*.test.ts`.
- Use `test()` directly (no `describe()` blocks).
- Each test creates an isolated environment via `convexTest(schema)`.
- Call Convex functions: `t.action(api.auth.signIn, { ... })`.
- Simulate identity: `t.withIdentity({ subject: claims.sub })`.
- Error assertions: `expect(...).rejects.toThrow("expected message")`.
- Use `test.todo("...")` for planned tests.
- Mock fetch via `vi.stubGlobal("fetch", ...)` + cleanup with `vi.unstubAllGlobals()`.
- Setup env per test with `setupEnv()` — sets `process.env` inline, no shared `beforeEach`.
- Test timeout: 10 seconds (configured in `vitest.config.mts`).

## ESLint Notes

- ESLint 9 flat config at repo root (`eslint.config.mjs`).
- `no-only-tests/no-only-tests: "warn"` — never commit `.only` tests.
- `@typescript-eslint/no-unused-vars: "warn"` — prefix unused vars with `_`.
- `@convex-dev/eslint-plugin` rules apply to `convex/**` and `packages/auth/src/component/**`.
- Auto-generated files are ignored: `convex/_generated/**`, `**/dist/**`, `**/*.d.ts`.

## Package Manager

- **Bun** — use `bun run`, `bun install`, `bunx`. Do not use npm/yarn/pnpm.
- Workspace protocol: `"workspace:*"` for local deps.
- Catalog versions: `"catalog:"` in sub-packages resolves from root `package.json` catalog.
