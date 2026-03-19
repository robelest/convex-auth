# DEPENDENCY_INVENTORY.md

## Purpose

Inventory runtime dependencies and Node builtin usage that affect edge-runtime
parity. This report is the M0 dependency baseline.

## Summary

Current repository is a single-package TypeScript project with runtime code in
`src/`. The main edge blockers are:

- Direct Node builtin imports in runtime paths.
- Node-bound crypto/signature/encryption libraries in `src/libsaml.ts`.
- Global `Buffer` dependence in runtime message processing paths.

## Current Workspace Update (2026-02-16)

Migration moved implementation into `packages/*`, enabled Bun workspace
catalogs, and removed all cross-package `../../.../src` imports.

Completed reductions:

- Root/runtime package internals now import workspace package names
  (`@samlify/*`) rather than relative source hops.
- Shared constants moved to `@samlify/constants` to avoid package-to-package
  `src` coupling.
- Static `fs` imports were removed from compat runtime code:
  - `packages/compat/src/libsaml.ts`
  - `packages/compat/src/metadata.ts`
- File I/O compatibility remains available behind runtime-resolved Node adapters
  (only used when `keyFile`/`exportMetadata` paths are used).
- `node-rsa` was removed from runtime package `packages/xmldsig-edge`; detached
  message signature signing/verification is now injected from compat.
- `node-rsa` was fully removed from workspace dependencies.
- `node-forge` was fully removed from workspace dependencies and replaced with
  `jsrsasign` for key/cert parsing and detached message signatures.
- `xml` package was removed from workspace dependencies and replaced by internal
  deterministic serializer (`packages/samlify/src/xml-builder.ts`).
- Flow tests no longer require Java/XSD validator for local end-to-end
  execution; they now use a basic well-formed XML validator in test setup.
- `xml-crypto` dependency usage was consolidated to `@samlify/xmldsig-edge`
  only; compat no longer imports it directly.
- `pako` was removed from workspace dependencies and replaced by `fflate` in
  compat utility compression helpers.
- `xpath` package was removed from workspace dependencies and replaced by
  `fontoxpath` through `packages/core-xml/src/xpath.ts`.
- Static gap report is now empty (`bun run report:edge-gaps` shows no remaining
  tracked imports in package sources).

Remaining replacement backlog (edge parity milestones):

### M3: Crypto primitive migration

- Detached message signature and key parsing now run through `jsrsasign`
  compatibility wrappers.
- Remaining M3-aligned work is focused on moving detached message signatures
  from compat wrappers to direct WebCrypto/Oslo primitives.

### M4-M6: XMLDSig engine replacement

- XMLDSig engine dependency is now runtime-loaded behind adapter boundary in
  `packages/xmldsig-edge/src/index.ts`.

### M7: XML Encryption replacement

- XML encryption engine dependency is now runtime-loaded behind adapter boundary
  in `packages/xmlenc-edge/src/index.ts`.

### M8+: Protocol/builder cleanup

- `xml` package no longer used; metadata generation now uses internal
  deterministic serializer.

### Cross-cutting runtime portability items

- `Buffer` usage has been removed from workspace package source paths.
- `fontoxpath` remains in use and requires fixture/security hardening through
  M4-M6.

## Node Builtin Usage in Runtime Code (`src/`)

### `fs`

- `src/libsaml.ts`
  - `fs.readFileSync(opts.keyFile)` in `verifySignature` key-file branch.
- `src/metadata.ts`
  - `fs.writeFileSync(exportFile, this.xmlString)` in `exportMetadata`.

Risk:

- Not edge-safe; filesystem is unavailable in edge runtimes.

Migration target:

- Move to adapter-based IO hooks in compatibility layer.
- Runtime core accepts in-memory key/cert/xml material only.

### `url`

- `src/binding-redirect.ts`
  - `url.parse(baseUrl)` for query detection.

Risk:

- Node URL API dependency.

Migration target:

- Replace with WHATWG `URL`/`URLSearchParams` behavior.

### `Buffer` global usage

Observed in:

- `src/utility.ts` (base64 encode/decode, inflate input handling)
- `src/flow.ts` (redirect/simpleSign signature decode)
- `src/libsaml.ts` (message signature verify and encryption params)

Risk:

- `Buffer` availability varies by edge runtime/polyfill setup.

Migration target:

- Use `Uint8Array`, `TextEncoder/TextDecoder`, and Web APIs.

## Runtime Third-Party Dependency Usage (`src/`)

### XML signature/encryption and crypto

- `node-rsa` in `src/libsaml.ts`
  - used for detached message signing/verification.
- `xml-crypto` in `src/libsaml.ts`
  - used for XML signature sign/verify.
- `@authenio/xml-encryption` in `src/libsaml.ts`
  - used for assertion encryption/decryption.
- `node-forge` in `src/utility.ts`
  - cert parsing and public/private key transforms.

Risk:

- Node-focused dependency behavior and runtime assumptions.

Migration target:

- Replace with internal edge-safe modules:
  - `packages/xmldsig-edge`
  - `packages/xmlenc-edge`
  - Oslo + WebCrypto wrappers for key/signature primitives

### XML parser/query stack

- `@xmldom/xmldom` in `src/api.ts`, `src/libsaml.ts`
- `xpath` in `src/extractor.ts`, `src/libsaml.ts`

Risk:

- Must confirm deterministic behavior and security invariants in edge runtime.

Migration target:

- Keep pure JS XML stack if edge-safe and deterministic.
- Add canonicalization/reference tests to enforce stable behavior.

### Other runtime libs

- `pako` in `src/utility.ts` (deflate/inflate)
- `xml` in metadata builders
- `camelcase`, `xml-escape`, `uuid`

Risk:

- Generally lower; still requires runtime compatibility review.

## Package-Level Inventory (from `package.json`)

Runtime dependencies:

- `@authenio/xml-encryption`
- `@xmldom/xmldom`
- `camelcase`
- `node-forge`
- `node-rsa`
- `pako`
- `uuid`
- `xml`
- `xml-crypto`
- `xml-escape`
- `xpath`

Development/test dependencies with notable constraints:

- `@authenio/samlify-xsd-schema-validator` requires Java runtime for full
  validation path.
- `vitest`, `timekeeper`, `typescript`, `tslint`.

## Test and Docs Environment Notes

- Tests in `test/flow.ts` rely on schema validator that shells out to Java.
- Local run without Java shows many flow failures due validation backend
  unavailability.
- Documentation examples commonly use filesystem reads (`fs.readFileSync`) for
  metadata/key loading.

These are compatibility/documentation concerns, not direct runtime package
blockers.

## Replacement Mapping (Approved Direction)

- `node-rsa` -> Oslo/WebCrypto wrapper module.
- `xml-crypto` -> internal `xmldsig-edge`.
- `@authenio/xml-encryption` -> internal `xmlenc-edge`.
- direct `fs`/`path`/`url` in runtime paths -> adapter + web-standard API
  replacements.

## Priority Order for Migration Work

1. Lock compatibility/security contracts before code churn.
2. Introduce workspace boundaries (no behavior changes) to isolate replacement
   surfaces.
3. Replace detached message signing and key handling (`node-rsa`, `node-forge`).
4. Replace XMLDSig path.
5. Replace XML encryption path.
6. Remove runtime builtin imports and enforce guardrails.

## Open Questions

- Whether to keep optional file-path compatibility in facade layer only.
- Whether `@xmldom/xmldom` + `xpath` should be retained or wrapped/replaced for
  strict determinism.
- Whether to preserve current error-style mix (string reject + Error) until
  post-parity cleanup.
