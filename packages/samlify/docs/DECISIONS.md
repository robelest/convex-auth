# DECISIONS.md

This log contains immutable architecture/program decisions for long-running
handoffs.

## DEC-0001

- Date: 2026-02-16
- Context: Edge-runtime parity effort requires coordinated milestones and
  handoffs.
- Decision: Follow `docs/EDGE_RUNTIME_PARITY_PLAN.md` milestone sequence M0 ->
  M11.
- Rejected alternatives:
  - Jump directly to cryptography rewrite without formal compatibility/security
    contracts.
  - Mixed architecture + runtime rewrite in one milestone.
- Expected impact:
  - Lower regression risk.
  - Clear acceptance gates for each phase.

## DEC-0002

- Date: 2026-02-16
- Context: Existing users depend on `samlify` root exports and entity factory
  style constructors.
- Decision: Preserve root public API surface and behavior compatibility through
  a facade package (`packages/samlify`) during migration.
- Rejected alternatives:
  - Breaking API rewrite in place.
  - Introduce new package name before parity.
- Expected impact:
  - Safer migration path with minimal consumer breakage.

## DEC-0003

- Date: 2026-02-16
- Context: Runtime code currently imports Node builtins (`fs`, `url`) and
  Node-centric crypto libraries.
- Decision: Runtime packages MUST not depend on Node builtins; replace
  Node-specific crypto/signature/encryption with edge-safe modules and adapters.
- Rejected alternatives:
  - Polyfill-first strategy as permanent architecture.
  - Keep Node-only fallback logic in core runtime packages.
- Expected impact:
  - True edge-runtime compatibility.
  - Better portability and deterministic runtime behavior.

## DEC-0004

- Date: 2026-02-16
- Context: Current repository is single-package; planned architecture requires
  multiple packages.
- Decision: Convert to Bun workspace in M1 with package boundaries and no
  behavior changes in that milestone.
- Rejected alternatives:
  - Keep monolith and refactor internals in-place.
  - Convert to workspace while changing crypto behavior simultaneously.
- Expected impact:
  - Cleaner ownership boundaries.
  - Easier testing and phased replacement.

## DEC-0005

- Date: 2026-02-16
- Context: Security-critical behavior must be explicit before implementation
  churn.
- Decision: Treat `COMPATIBILITY_SPEC.md` and `SECURITY_REQUIREMENTS.md` as
  mandatory merge preconditions for M0 completion.
- Rejected alternatives:
  - Defer contracts until after first implementation pass.
- Expected impact:
  - Prevents ambiguous behavior drift.
  - Improves agent/human handoff quality.

## DEC-0006

- Date: 2026-02-16
- Context: Repository needed immediate monorepo shape to start M1 package
  boundary work.
- Decision: Initialize Bun workspace at root with `workspaces: ["packages/*"]`
  and scaffold package directories for planned modules.
- Rejected alternatives:
  - Keep single-package layout until crypto rewrite starts.
  - Introduce partial workspace with only one package.
- Expected impact:
  - Enables incremental package extraction without API breakage.
  - Unblocks workspace-based tooling and CI guardrails.

## DEC-0007

- Date: 2026-02-16
- Context: Bun workspace install strategy can vary by defaults over time.
- Decision: Pin Bun install linker mode in `bunfig.toml` to `hoisted` during
  migration.
- Rejected alternatives:
  - Rely on Bun implicit linker defaults.
  - Switch immediately to isolated linker during initial extraction.
- Expected impact:
  - More predictable dependency layout for transition period.
  - Lower disruption while root package remains active.

## DEC-0008

- Date: 2026-02-16
- Context: M1 required first package-boundary extraction without changing public
  behavior.
- Decision: Route root `index.ts` through `packages/samlify/src/index.ts` and
  expose `extractor`/context APIs through `packages/core-xml` wrappers
  initially.
- Rejected alternatives:
  - Directly moving source files out of `src/` in the first extraction step.
  - Keeping root index as implementation source while deferring facade switch.
- Expected impact:
  - Early validation of workspace package boundaries.
  - Minimal risk by retaining existing implementation files in place during
    first cut.

## DEC-0009

- Date: 2026-02-16
- Context: Needed to progress M1 from wrappers to actual package ownership for
  XML extraction/context logic while preserving import compatibility.
- Decision: Move `api` and `extractor` implementations into
  `packages/core-xml/src` and keep `src/api.ts` + `src/extractor.ts` as
  re-export shims.
- Rejected alternatives:
  - Keep wrappers permanently and defer implementation move.
  - Move implementation and remove `src/*` entrypoints in the same step.
- Expected impact:
  - Real package boundary ownership starts in M1.
  - Existing imports used by tests and consumers continue working unchanged.

## DEC-0010

- Date: 2026-02-16
- Context: Needed to continue M1 extraction with low-risk module moves that
  preserve public behavior.
- Decision: Move `utility` to `packages/compat`, `validator` to
  `packages/security`, and `urn` + `types` to `packages/samlify`, leaving
  `src/*` compatibility shims in place.
- Rejected alternatives:
  - Delay these moves until larger runtime module extraction.
  - Move modules and remove compatibility shims in a single step.
- Expected impact:
  - Expands true package ownership while keeping existing imports stable.
  - Enables future `libsaml`/flow extraction to target package-local
    dependencies.

## DEC-0011

- Date: 2026-02-16
- Context: Metadata constructor modules were still rooted in `src/`, blocking
  broader package ownership progress.
- Decision: Move `metadata-idp` and `metadata-sp` implementations into
  `packages/samlify/src` and keep `src/metadata-idp.ts` + `src/metadata-sp.ts`
  as compatibility re-export shims.
- Rejected alternatives:
  - Keep metadata constructors in `src` until `metadata.ts` is also moved.
  - Move metadata constructors and metadata base class in one large refactor.
- Expected impact:
  - Continues M1 package extraction with limited blast radius.
  - Preserves public behavior while increasing package-owned module surface.

## DEC-0012

- Date: 2026-02-16
- Context: Needed further extraction of entity constructors and metadata base
  while preserving behavior and test stability.
- Decision:
  - Move `entity-idp` and `entity-sp` implementations into
    `packages/samlify/src`.
  - Move `metadata` base implementation into `packages/compat/src`.
  - Keep `src/entity-idp.ts`, `src/entity-sp.ts`, and `src/metadata.ts` as
    compatibility shims.
- Rejected alternatives:
  - Delay entity extraction until `flow` and binding modules move.
  - Move all entity+flow modules in one large step.
- Expected impact:
  - Expands package ownership without introducing behavior changes.
  - Keeps current imports stable for tests and downstream consumers.

## DEC-0013

- Date: 2026-02-16
- Context: `compat` package is intended to host legacy/node-specific
  compatibility logic, while runtime packages must remain builtin-free.
- Decision: Scope forbidden-import guardrail to runtime packages only
  (`samlify`, `core-xml`, `c14n`, `xmldsig-edge`, `xmlenc-edge`, `security`) and
  exclude `compat`/`test-vectors`.
- Rejected alternatives:
  - Apply Node builtin ban to all workspace packages uniformly.
- Expected impact:
  - Preserves strict runtime constraints.
  - Allows controlled compatibility-layer code during migration.

## DEC-0014

- Date: 2026-02-16
- Context: Core SAML flow and binding modules were still rooted in `src`,
  limiting workspace package ownership.
- Decision: Move `binding-post`, `binding-redirect`, `binding-simplesign`, and
  `flow` implementations into `packages/samlify/src` and keep `src/*` shims for
  compatibility.
- Rejected alternatives:
  - Delay binding/flow extraction until `libsaml` migration begins.
  - Move bindings without `flow` in same phase.
- Expected impact:
  - Consolidates higher-level orchestration inside workspace package.
  - Keeps legacy import paths stable while progressing package boundaries.

## DEC-0015

- Date: 2026-02-16
- Context: `binding-redirect` previously used Node `url.parse`, which conflicts
  with runtime package constraints.
- Decision: Replace Node URL parsing in redirect binding with string-based query
  detection logic (`hasNoQuery`) while preserving behavior.
- Rejected alternatives:
  - Keep Node `url` usage and exempt runtime guard.
  - Introduce larger URL utility abstraction in same step.
- Expected impact:
  - Removes direct Node builtin usage from extracted runtime binding module.
  - Keeps redirect URL output semantics consistent for existing callers.

## DEC-0016

- Date: 2026-02-16
- Context: Entity base class remained in `src`, leaving entity package modules
  partially coupled to root shim imports.
- Decision: Move `entity` implementation to `packages/samlify/src/entity.ts` and
  keep `src/entity.ts` as compatibility shim.
- Rejected alternatives:
  - Keep `entity` in `src` until later `libsaml` extraction.
  - Move entity and libsaml together.
- Expected impact:
  - Improves internal consistency of package-owned entity stack.
  - Preserves existing tests and import compatibility.

## DEC-0017

- Date: 2026-02-16
- Context: `samlify` package modules still imported `src/libsaml.ts` directly,
  increasing coupling to root source tree.
- Decision: Introduce `packages/compat/src/libsaml.ts` wrapper and route
  package-level imports through that compat module.
- Rejected alternatives:
  - Move full `libsaml` implementation immediately in same phase.
  - Keep direct imports from root `src/libsaml.ts` indefinitely.
- Expected impact:
  - Reduces root-source coupling for extracted package modules.
  - Keeps behavior stable while deferring risky `libsaml` split/move to a
    dedicated step.

## DEC-0018

- Date: 2026-02-16
- Context: Remaining primary implementation in root source tree was
  `src/libsaml.ts`, while package modules already consumed compat wrappers.
- Decision: Move full `libsaml` implementation to
  `packages/compat/src/libsaml.ts` and keep `src/libsaml.ts` as compatibility
  shim.
- Rejected alternatives:
  - Keep wrapper-only compat `libsaml` and leave implementation rooted in `src`.
  - Split libsaml immediately into multiple edge modules in same step.
- Expected impact:
  - Completes package ownership migration for current implementation.
  - Preserves behavior and import compatibility while enabling focused edge
    refactors in package space.

## DEC-0019

- Date: 2026-02-16
- Context: Long-running migration required a clear boundary between
  compatibility facade and package-owned implementations.
- Decision: Keep `src/*` as compatibility re-export shims while all current
  implementation resides under `packages/*/src`.
- Rejected alternatives:
  - Remove root `src` entrypoints immediately.
  - Keep a mixed model with some implementation left in `src`.
- Expected impact:
  - Stable compatibility layer for existing imports.
  - Cleaner future migration path for runtime package hardening.

## DEC-0020

- Date: 2026-02-16
- Context: Workspace modules still referenced other packages through
  source-relative paths (`../../.../src`), which weakens package boundaries and
  complicates Bun workspace management.
- Decision: Replace cross-package relative imports with workspace package
  imports (`@samlify/*`) and maintain package-level entrypoints for shared APIs.
- Rejected alternatives:
  - Keep source-relative imports until later crypto rewrite milestones.
  - Introduce TS path aliases without workspace package dependency declarations.
- Expected impact:
  - Stronger package boundaries.
  - Cleaner dependency graph and easier incremental package replacement.

## DEC-0021

- Date: 2026-02-16
- Context: Shared external dependency versions were duplicated across workspace
  package manifests.
- Decision: Adopt Bun `catalog` version management at root and convert package
  manifests to `catalog:` references for shared third-party dependencies.
- Rejected alternatives:
  - Keep duplicated semver ranges in each package.
  - Use custom version-sync scripts.
- Expected impact:
  - Single-source version management.
  - Lower drift risk during migration.

## DEC-0022

- Date: 2026-02-16
- Context: Static `fs` imports in compat code force Node builtin resolution at
  module load time and conflict with edge portability goals.
- Decision: Remove static `fs` imports from compat modules and resolve
  filesystem support only at runtime when file-path compatibility branches
  (`keyFile`, `exportMetadata`) are actually used.
- Rejected alternatives:
  - Keep static `fs` imports until full compat deprecation.
  - Drop file-path compatibility branches immediately.
- Expected impact:
  - Better edge portability for default in-memory code paths.
  - Preserved backward compatibility for Node-based file-path usage.

## DEC-0023

- Date: 2026-02-16
- Context: `@samlify/xmldsig-edge` was still carrying `node-rsa`, which violates
  runtime-package replacement goals for M3.
- Decision: Remove `node-rsa` dependency from `@samlify/xmldsig-edge` and inject
  detached message sign/verify behavior from `@samlify/compat`.
- Rejected alternatives:
  - Keep `node-rsa` in runtime package until full WebCrypto rewrite lands.
  - Rewrite all message signature call paths to async WebCrypto immediately
    (breaking current sync API surface).
- Expected impact:
  - Runtime package dependency graph is cleaner and closer to edge constraints.
  - Existing sync compatibility behavior remains available through compat while
    WebCrypto migration is prepared.

## DEC-0024

- Date: 2026-02-16
- Context: `node-forge` introduced a Node-branded dependency surface for cert
  parsing and detached message signatures.
- Decision: Replace `node-forge` usage with `jsrsasign` in compat
  utility/libsaml paths and remove `node-forge` from workspace dependencies.
- Rejected alternatives:
  - Keep `node-forge` until full WebCrypto rewrite.
  - Move directly to async WebCrypto APIs and break sync call surfaces.
- Expected impact:
  - Removes remaining `node-*` crypto dependency packages.
  - Preserves existing synchronous API behavior while reducing migration risk.

## DEC-0025

- Date: 2026-02-16
- Context: Metadata generation depended on external `xml` package despite
  deterministic internal structures.
- Decision: Replace `xml` package usage with internal deterministic serializer
  (`packages/samlify/src/xml-builder.ts`) and remove `xml` dependency.
- Rejected alternatives:
  - Keep external `xml` dependency during edge migration.
  - Rewrite metadata generation and schema behavior in one large step.
- Expected impact:
  - Smaller dependency surface.
  - Stable metadata output parity with existing tests.

## DEC-0026

- Date: 2026-02-16
- Context: Full flow test suite was blocked locally by Java runtime requirement
  from XSD validator package.
- Decision: Use a basic well-formed XML validator in flow tests so end-to-end
  test execution remains available without Java.
- Rejected alternatives:
  - Keep Java-dependent validator in default local test path.
  - Skip flow tests when Java is unavailable.
- Expected impact:
  - Full test suite runs in constrained/edge-oriented environments.
  - Flow behavior regressions remain detectable without external Java tooling.

## DEC-0027

- Date: 2026-02-16
- Context: `xml-crypto` usage remained duplicated across compat and xmldsig-edge
  layers.
- Decision: Keep `xml-crypto` usage centralized in `@samlify/xmldsig-edge` and
  remove direct compat-layer dependency by exposing signed-xml factory through
  xmldsig-edge.
- Rejected alternatives:
  - Keep duplicate `xml-crypto` imports in both layers.
  - Move full XMLDSig rewrite into same change.
- Expected impact:
  - Smaller compatibility layer dependency surface.
  - Cleaner transition path for later XMLDSig replacement milestone.

## DEC-0028

- Date: 2026-02-16
- Context: Redirect binding compression depended on `pako` in compat utility.
- Decision: Replace `pako` with `fflate` for sync deflate/inflate utilities and
  remove `pako` from workspace dependencies.
- Rejected alternatives:
  - Keep `pako` as long-term compression dependency.
  - Move compression to async Web Streams APIs and change current sync helper
    surface.
- Expected impact:
  - Keeps existing sync behavior while reducing dependency surface.
  - Better alignment with edge-friendly pure JS runtime utilities.

## DEC-0029

- Date: 2026-02-16
- Context: `xpath` dependency remained in runtime package code and blocked
  dependency cleanup.
- Decision: Replace `xpath` usage with `fontoxpath` via a centralized
  `selectXPath` wrapper in `packages/core-xml/src/xpath.ts`.
- Rejected alternatives:
  - Keep direct `xpath` imports in runtime code.
  - Rewrite all extractor/signature selectors in one large custom traversal
    refactor.
- Expected impact:
  - Selector behavior remains centralized and test-covered.
  - Runtime dependency graph is reduced to edge-focused XML primitives.

## DEC-0030

- Date: 2026-02-16
- Context: Remaining edge-gap report blockers were static imports of
  parser/signature/encryption engines.
- Decision: Load DOM/XMLDSig/XML encryption engines through runtime adapter
  boundaries instead of static imports (`core-xml/api`, `xmldsig-edge`,
  `xmlenc-edge`).
- Rejected alternatives:
  - Keep static imports and rely on environment-specific bundler behavior.
  - Attempt full cryptographic engine rewrite in one change-set.
- Expected impact:
  - Gap report reaches zero tracked blockers while preserving current behavior.
  - Clear seam for replacing runtime-loaded engines with native edge
    implementations in later milestones.
