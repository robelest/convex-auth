# WORKSPACE_MIGRATION_DIFF_PLAN.md

## Goal

Convert the current single-package repository into a Bun workspace without
changing runtime behavior in M1.

This document is a migration diff plan, not the implementation itself.

## M1 Progress Snapshot

- Bun workspace root enabled (`package.json` workspaces + `bunfig.toml`).
- Package skeleton created under `packages/*`.
- Root facade switched to `packages/samlify/src/index.ts`.
- `core-xml` wrapper package introduced for extractor and parser context APIs.
- `core-xml` now owns the extractor/context implementation; `src/api.ts` and
  `src/extractor.ts` are compatibility re-export shims.
- `compat` now owns utility implementation; `src/utility.ts` is a compatibility
  re-export shim.
- `security` now owns validator implementation; `src/validator.ts` is a
  compatibility re-export shim.
- `samlify` package now owns `urn` and `types`; `src/urn.ts` and `src/types.ts`
  are compatibility re-export shims.
- `samlify` package now owns `metadata-idp` and `metadata-sp`;
  `src/metadata-idp.ts` and `src/metadata-sp.ts` are compatibility re-export
  shims.
- `compat` now owns metadata base class; `src/metadata.ts` is a compatibility
  re-export shim.
- `samlify` package now owns `entity-idp` and `entity-sp`; `src/entity-idp.ts`
  and `src/entity-sp.ts` are compatibility re-export shims.
- `samlify` package now owns redirect/post/simpleSign bindings and `flow`;
  `src/binding-*.ts` and `src/flow.ts` are compatibility re-export shims.
- `samlify` package now owns `entity` base class; `src/entity.ts` is a
  compatibility re-export shim.
- Redirect binding no longer uses Node `url` API (query detection is now
  string-based), aligning with runtime constraints.
- `samlify` package modules now reference a compat `libsaml` wrapper
  (`packages/compat/src/libsaml.ts`) instead of importing root `src/libsaml.ts`
  directly.
- `compat` now owns full `libsaml` implementation; `src/libsaml.ts` is a
  compatibility re-export shim.
- The root `src/` tree is now entirely compatibility shims pointing to
  `packages/*/src` implementations.
- Runtime forbidden-import guardrail script and workflow are in place.

## Current State

- Root package only (`package.json` has no `workspaces`).
- Source in `src/`, tests in `test/`, docs in `docs/`.
- Build output in `build/`, declarations in `types/`.

## Target Workspace Layout

```
packages/
  samlify/         # compatibility facade, root public API
  core-xml/        # XML DOM helpers, extraction helpers, ID indexing
  c14n/            # canonicalization + transform engine
  xmldsig-edge/    # XML signature verify/sign
  xmlenc-edge/     # XML encryption/decryption
  security/        # policy checks (issuer/audience/destination/time/replay hooks)
  compat/          # legacy adapter layer and behavior shims
  test-vectors/    # shared fixtures and adversarial vectors
```

## M1 Rules

1. No observable behavior change.
2. Existing tests should continue to run against compatibility facade.
3. Export names and call signatures remain stable.
4. Existing docs/examples remain valid for consumers.

## Proposed File Move Map (Initial)

### `packages/samlify`

Move/copy first:

- `index.ts`
- `src/entity.ts`
- `src/entity-idp.ts`
- `src/entity-sp.ts`
- `src/types.ts`
- `src/urn.ts`
- thin adapters that call into future internal packages

### `packages/core-xml`

Move/copy first:

- `src/extractor.ts`
- parser context parts of `src/api.ts`

### `packages/compat`

Move/copy first:

- compatibility wrappers for legacy options (`metadata`, `keyFile`, file-path
  style usage)
- temporary filesystem adapters (non-runtime package)

### Deferred to later milestones

- `src/libsaml.ts` split into `xmldsig-edge`, `xmlenc-edge`, and key-handling
  wrappers
- hard security policy checks into `packages/security`

## Root `package.json` Diff Plan

Add:

- `"private": true`
- `"workspaces": ["packages/*"]`
- root scripts that delegate to workspace scripts (`build`, `test`, `lint`,
  `typecheck`)

Keep temporarily:

- existing root scripts as compatibility aliases during transition

## Bun Workspace APIs We Need (Context7)

Use these Bun workspace primitives during M1:

- Root workspace declaration:
  - `"private": true`
  - `"workspaces": ["packages/*"]`
- Inter-package dependency linking:
  - use `"workspace:*"` between internal packages
- Workspace-aware install:
  - `bun install` installs all workspace dependencies
  - `bun install --filter '<pattern>'` targets selected workspaces
- Workspace script execution:
  - `bun run --workspaces <script>` for all packages
  - `bun run --filter '<pattern>' <script>` for selected packages
  - `bun run --parallel --workspaces <script>` for parallel runs
  - `bun run --sequential --workspaces <script>` for ordered runs
- Output control for filtered runs:
  - `--elide-lines <n>` and `--no-exit-on-error` as needed
- Workspace install strategy in `bunfig.toml`:
  - `[install] linker = 'hoisted' | 'isolated'`
  - set this explicitly to avoid implicit mode changes over time
- Publish behavior note:
  - `bun publish` strips workspace/catalog protocol references from published
    manifest

Optional (not required for M1, useful later):

- Root `workspaces.catalog` / `workspaces.catalogs` for centralized version
  pinning
- Root `overrides` for transitive dependency constraints

## Testing Strategy During Migration

- Keep current `test/*` running against facade package (`packages/samlify`).
- Add package-local tests incrementally.
- Introduce shared fixtures via `packages/test-vectors` once paths are stable.

## CI Diff Plan

Phase 1 (M1):

- Run existing test suite against facade package.
- Add workspace install/build sanity checks.

Phase 2 (M2+):

- Add runtime forbidden-import scanner for runtime packages.
- Add package-specific security/interop lanes.

## Dependency/Fork Strategy for External Libraries

Default policy:

- Prefer internal implementations for `xmldsig-edge` and `xmlenc-edge`.
- Use upstream libraries as behavior references and fixture sources, not
  long-term runtime dependencies.

Fork policy (only if needed):

- Fork only when required for short-term unblockers.
- Pin by commit and document exit criteria.
- Track each fork in `DECISIONS.md` with owner and retirement plan.

## Rollout Plan

1. Prepare workspace skeleton and package manifests.
2. Move facade code with re-exports and path-preserving imports.
3. Keep root build/test commands functioning.
4. Validate no behavior drift with current tests.
5. Start M2 guardrails once package boundaries are in place.

## Definition of Done (M1)

- Workspace layout exists and installs with Bun.
- Existing API is unchanged for consumers.
- Existing tests pass at parity level (environment caveats like Java noted).
- No intentional crypto/security behavior changes introduced in M1.
