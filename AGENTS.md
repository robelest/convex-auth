# AGENTS.md — Coding Agent Guidelines for convex-auth

## Project Overview

Monorepo for `@robelest/convex-auth` — a Convex authentication library. Uses
**pnpm** workspaces and **Vite+** (`vp`) as the top-level workflow tool with ESM
(`"type": "module"`) throughout.

| Package            | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `packages/auth`    | Core library (server, client, providers, CLI, Convex component) |
| `tests/`           | Vitest test suite (convex, node, and samlify projects)          |
| `packages/samlify` | Local SAML runtime fork used for group SSO work                 |
| `convex/`          | App-level Convex backend functions                              |

## Build / Lint / Test Commands

All commands run from the **repo root** unless noted.

```bash
# Build the auth library and refresh component codegen
vp run build

# Lint / format / checks (entire monorepo)
vp run lint
vp run fmt
vp run check

# Run all tests once (CI-style)
vp run test

# Run convex + node tests in watch mode
vp test --project convex --project node

# Run Docker-backed interop tests
vp test --project interop

# Run a single test project
vp test --run --project convex

# Generate Convex types (app + component)
vp run codegen:convex
```

### Build Sub-steps (packages/auth)

The library builds in four stages:

1. `build:version` — generates `src/server/version.ts` from `package.json`
2. `build:bin` — tsdown bundles CLI to `dist/bin.js`
3. `build:server` — tsc with `tsconfig.server.json` (server + providers)
4. `build:client` — tsc with `tsconfig.client.json` (client + error types)
5. `build:component` — tsc with `tsconfig.component.json` (Convex component)

## TypeScript Configuration

- **`strict: true`** in all tsconfigs — do not weaken.
- `target: "ESNext"`, `module: "ESNext"` for the auth package.
- `moduleResolution: "bundler"` in all packages.
- `declaration: true`, `declarationMap: true`, `sourceMap: true` for the auth
  package.
- `stripInternal: true` on server build — use `@internal` JSDoc to hide from
  public types.

## Code Style

### Formatting (Prettier)

Root config is minimal: `{ "proseWrap": "always" }`. Defaults apply:

- Double quotes, semicolons, 2-space indentation, default trailing commas.

### Imports

- **ES module imports only** (`import { X } from "module"`).
- **No `.js` extensions** on relative imports (e.g.,
  `import { foo } from "./utils"`).
- Separate **type-only imports**: `import type { Foo } from "module"`.
- Order: third-party imports first, then relative imports.
- Re-exports: `export { X } from "module"` and
  `export type { X } from "module"`.

### Naming Conventions

| Element           | Convention         | Examples                             |
| ----------------- | ------------------ | ------------------------------------ |
| Files             | `camelCase.ts`     | `signIn.ts`, `authCookies.ts`        |
| Functions         | `camelCase`        | `signIn`, `parseAuthCookies`         |
| Classes           | `PascalCase`       | `Auth`                               |
| Types/Interfaces  | `PascalCase`       | `AuthCookies`, `ConvexAuthConfig`    |
| Constants         | `UPPER_SNAKE_CASE` | `AUTH_ERRORS`, `JWT_STORAGE_KEY`     |
| Unused params     | `_` prefix         | `_ctx`, `_args`                      |
| Private fields    | `_` prefix         | `_auth`                              |
| Provider defaults | lowercase function | `export default function password()` |

### Error Handling

The project uses a **structured error system** built on `ConvexError` and the Fx
`AuthError` class:

```typescript
import { AuthError } from "./fx";
import { isAuthError, parseAuthError } from "./errors";

// Internal: throw via AuthError (preferred in server code)
throw new AuthError("NOT_SIGNED_IN").toConvexError();

// Internal: in Fx pipelines
Fx.fail(new AuthError("EMAIL_SEND_FAILED", "Custom message"));

// Consumer API: throwAuthError (exported for library consumers)
import { throwAuthError } from "@robelest/convex-auth/errors";
throwAuthError("NOT_SIGNED_IN");

// Type guard
if (isAuthError(error)) {
  /* error is ConvexError<{code, message}> */
}

// Parse from any error shape
const parsed = parseAuthError(error); // { code, message } | null
```

- Internal code uses `new AuthError(code).toConvexError()` or
  `Fx.fail(new AuthError(code))` — do NOT throw raw `ConvexError` directly.
- `throwAuthError(code)` is exported for **consumer** convenience.
- Use `try/catch` with `console.error` for non-fatal issues (token refresh,
  etc.).
- Silent `catch {}` is acceptable for cleanup operations (sign-out, storage
  deletion).
- Provider validation errors can use plain `throw new Error("message")`.

### CRUD Verb Conventions

Entity methods follow a standard verb set:

| Operation   | Verb     | Notes                                     |
| ----------- | -------- | ----------------------------------------- |
| Create      | `create` | Always `create`, not `add`                |
| Read one    | `get`    | Positional ID: `auth.user.get(ctx, id)`   |
| Read many   | `list`   | Options object: `auth.user.list(ctx, {})` |
| Update      | `update` | Always `update`, not `patch`              |
| Hard delete | `delete` | Permanent removal                         |
| Soft delete | `revoke` | Status change (keys, invites)             |

Parameter shape rule: single-ID lookups use positional args; multi-field inputs
use options objects.

### Exports & Architecture Patterns

- **Factory functions over classes**: prefer `function createThing(opts)`
  returning an object over `class Thing`. This enables Convex bundler
  tree-shaking via `export const { x, y } = factory(config)`.
- **Barrel files**: use `index.ts` to re-export public API from sub-modules.
- **Named exports** for most things; **default exports** only for provider
  functions.
- Use `as const satisfies Record<K, V>` for exhaustive typed constant maps.
- Derive types from constants: `type Code = keyof typeof AUTH_ERRORS`.

### TypeScript Patterns

- `any` is allowed (ESLint `no-explicit-any` is off) — use it for Convex context
  objects and dynamic provider types where strict typing is impractical.
- Function overloads for different auth modes (optional vs required user).
- Generics with Convex data model: `<DataModel extends GenericDataModel>`.
- `void` prefix for fire-and-forget promises: `void refreshToken()`.
- SSR guards: `typeof window !== "undefined"`.
- Discriminated unions for state management.

### JSDoc

- Add `/** JSDoc */` with `@param`, `@returns`, `@example` on all **public API**
  functions.
- Use `@internal` to exclude from generated `.d.ts` files (server build uses
  `stripInternal`).
- Use `@module` at the top of entry-point files.

## Testing Conventions

- **Framework**: Vitest + convex-test + edge-runtime environment.
- Tests live under `tests/` (root feature tests and `tests/group/*.test.ts`).
- Use `test()` directly (no `describe()` blocks).
- Each test creates an isolated environment via `convexTest(schema)`.
- Call Convex functions: `t.action(api.auth.signIn, { ... })`.
- Simulate identity: `t.withIdentity({ subject: claims.sub })`.
- Error assertions: `expect(...).rejects.toThrow("expected message")`.
- Use `test.todo("...")` for planned tests.
- Mock fetch via `vi.stubGlobal("fetch", ...)` + cleanup with
  `vi.unstubAllGlobals()`.
- Setup env per test with `setupEnv()` — sets `process.env` inline, no shared
  `beforeEach`.
- Test timeout: 10 seconds (configured in `vite.config.ts`).

## ESLint Notes

- ESLint 9 flat config at repo root (`eslint.config.mjs`).
- `no-only-tests/no-only-tests: "warn"` — never commit `.only` tests.
- `@typescript-eslint/no-unused-vars: "warn"` — prefix unused vars with `_`.
- `@convex-dev/eslint-plugin` rules apply to `convex/**` and
  `packages/auth/src/component/**`.
- Auto-generated files are ignored: `convex/_generated/**`, `**/dist/**`,
  `**/*.d.ts`.

## Package Manager

- **pnpm via Vite+** — use `vp install`, `vp run`, and `vp exec` as the normal
  workflow surface. Do not use npm/yarn/bun directly for package management.
- Workspace protocol: `"workspace:*"` for local deps.
- Catalog versions: `"catalog:"` in sub-packages resolve from
  `pnpm-workspace.yaml`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown,
Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management,
package management, and frontend tooling in a single global CLI called `vp`.
Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and
`vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run
`vp help` to print a list of commands and `vp <command> --help` for information
about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as
pnpm, npm, or Yarn through the `packageManager` field in `package.json` or
package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example,
`vp dev --port 3000` runs Vite's dev server and works the same as Vite.
`vp test` runs JavaScript tests through the bundled Vitest. The version of all
tools can be checked using `vp --version`. This is useful when researching
documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn
  directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or
  `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`,
  etc.) always run the Vite+ built-in tool, not any `package.json` script of the
  same name. To run a custom script that shares a name with a built-in command,
  use `vp run <script>`. For example, if you have a custom `dev` script that
  runs multiple services concurrently, run it with `vp run dev`, not `vp dev`
  (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps
  these tools. They must not be installed directly. You cannot upgrade these
  tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of
  package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from
  `vite` or `vitest`, all modules should be imported from the project's
  `vite-plus` dependency. For example,
  `import { defineConfig } from 'vite-plus';` or
  `import { expect, test, vi } from 'vite-plus/test';`. You must not install
  `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`,
  `vp lint --type-aware` works out of the box.

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->
