# SAMLify Edge Runtime Parity Plan

## Purpose

This document is the execution plan for building an edge-runtime-compatible fork
of SAMLify with full enterprise SAML feature coverage. It is designed as a
handoff artifact for autonomous coding agents and human contributors.

## Ownership and Repo Policy

- Fork repository: `robelest/samlify`
- Local path: `/Users/estifanos/Documents/dev/samlify`
- Upstream remote: `tngan/samlify`
- Policy: **never push to upstream**
- Upstream usage: fetch/rebase/reference only

## Problem Statement

Current SAMLify runtime behavior depends on Node-oriented packages and patterns
that do not fit edge runtimes used by Convex components and similar execution
environments. The blockers are ecosystem and implementation choices, not missing
cryptographic primitives in edge runtimes.

Edge runtimes already provide the critical primitives:

- WebCrypto (`crypto.subtle`) for signature and digest operations
- secure randomness
- string and binary processing
- XML parsing libraries in pure JS

The migration challenge is correctness and security of XMLDSig and XML
Encryption behavior, plus preserving SAMLify compatibility.

## Goals

1. Keep SAMLify public API compatibility as close as practical.
2. Remove Node builtin dependencies from runtime-critical code paths.
3. Support edge runtimes without runtime split logic.
4. Preserve enterprise feature scope for SAML SSO/SLO and encrypted assertions.
5. Ship hardened validation behavior against known SAML attack vectors.

## Non-Goals

- No WorkOS or external SAML broker dependency.
- No WASM-first runtime strategy as a core requirement.
- No attempt to upstream this work back to `tngan/samlify`.

## Delivery Principles

- Security before convenience.
- Compatibility by contract, not assumptions.
- Deterministic behavior and reproducible test vectors.
- Runtime-agnostic internals, runtime-specific adapters only where unavoidable.

## Proposed Workspace Architecture (Bun)

Create a monorepo layout inside this fork:

- `packages/samlify` - compatibility facade and public exports
- `packages/core-xml` - XML DOM utilities, traversal, ID indexing
- `packages/c14n` - canonicalization and transform engine
- `packages/xmldsig-edge` - XML signature verify/sign logic
- `packages/xmlenc-edge` - XML encryption/decryption implementation
- `packages/security` - policy enforcement, validation gates, replay hooks
- `packages/compat` - adapters for legacy internal call signatures
- `packages/test-vectors` - fixtures for interop and adversarial validation

## Dependency Strategy

Preferred cryptographic stack:

- `@oslojs/crypto`
- `@oslojs/asn1`
- `@oslojs/encoding`
- native WebCrypto (`crypto.subtle`)

XML and parser guidance:

- Keep XML stack pure JS and edge-safe.
- Avoid Node-coupled transitive dependencies in runtime packages.
- Avoid filesystem assumptions for templates, schemas, or cert/key loading.

## Replacement Mapping

Runtime dependencies to retire or bypass:

- `node-rsa` -> Oslo + WebCrypto based wrappers
- `xml-crypto` -> internal `xmldsig-edge` module
- `@authenio/xml-encryption` -> internal `xmlenc-edge` module
- `xml` package usage -> deterministic XML builders/templates
- direct `fs/path/url` usage -> in-memory and injected data loaders

## Compatibility Contract (Must Document First)

Before any major rewrite work, produce a formal compatibility contract:

- API exports and signatures
- default option behavior
- error categories and thrown conditions
- metadata generation semantics
- login/logout flow outputs for redirect/post
- signature placement and algorithm defaults

Deliverable: `COMPATIBILITY_SPEC.md`

## Security Contract (Must Document First)

Define acceptance-level guarantees before implementation:

- strict reference resolution and unique ID policy
- signature wrapping resistance
- digest/signature algorithm allowlists
- destination/audience/inResponseTo enforcement
- assertion time validation behavior and drift policy
- replay protection hook contract

Deliverable: `SECURITY_REQUIREMENTS.md`

## Milestone Plan

### M0 - Program Setup and Baseline Inventory

Scope:

- audit current runtime dependency graph
- inventory all Node builtin usage
- capture current tests and fixture coverage
- define compatibility and security contracts

Exit Criteria:

- `COMPATIBILITY_SPEC.md` committed
- `SECURITY_REQUIREMENTS.md` committed
- dependency inventory report committed

### M1 - Bun Workspace Migration and Package Boundaries

Scope:

- migrate repo to Bun workspace layout
- split internal modules into package boundaries
- preserve behavior while moving code

Exit Criteria:

- all existing tests still pass
- no behavior changes in this milestone
- package boundaries in place for future work

### M2 - Runtime Guardrails

Scope:

- add CI checks that fail runtime packages on Node builtin imports
- add lint rule and static scanner for forbidden modules
- enforce no filesystem assumptions in runtime code

Exit Criteria:

- CI fails on `fs/path/crypto/url/stream` imports in runtime packages
- guardrails documented and active

### M3 - Cryptographic Primitive Migration

Scope:

- replace `node-rsa` paths with Oslo/WebCrypto wrappers
- normalize key parsing and import behavior
- keep compatibility-level options where feasible

Exit Criteria:

- message signature sign/verify parity tests pass
- runtime code no longer depends on `node-rsa`

### M4 - Canonicalization Engine

Scope:

- implement required C14N modes for SAML usage
- implement required transform chain behavior
- lock deterministic output against fixtures

Exit Criteria:

- canonicalization fixtures pass
- deterministic hash comparisons stable across runtimes

### M5 - XMLDSig Verification Hardening

Scope:

- strict URI/reference resolution
- unique ID enforcement
- verified-node and consumed-node identity checks
- wrapping attack regression suite

Exit Criteria:

- adversarial XMLDSig suite passes
- wrapped/tampered vectors reliably rejected

### M6 - XMLDSig Signing Parity

Scope:

- generate signatures with compatibility-level placement
- support redirect and post flow signing semantics

Exit Criteria:

- generated signatures accepted by fixture validators and interop harness

### M7 - XML Encryption Parity

Scope:

- support encrypted assertion decrypt path
- support encryption path where required
- enforce secure algorithm defaults and explicit insecure opt-in

Exit Criteria:

- encrypted assertion roundtrip fixtures pass
- policy gate rejects disabled algorithms by default

### M8 - Protocol Flow Integration

Scope:

- integrate rewritten internals into login/logout request/response flows
- preserve metadata behavior and parser expectations

Exit Criteria:

- full flow suite passes for redirect and post bindings
- compatibility suite shows no major API regressions

### M9 - Security Gate and Threat Validation

Scope:

- run comprehensive security gate against known SAML attack classes
- verify time, audience, destination, and request correlation behavior

Exit Criteria:

- `SECURITY_GATE_REPORT.md` committed with passing evidence

### M10 - Interop Gate

Scope:

- validate against major IdP fixture sets
- include signed response/assertion combinations and encrypted assertions

Exit Criteria:

- `INTEROP_REPORT.md` committed
- all required provider profiles pass

### M11 - Release Candidate and Migration Docs

Scope:

- package/release strategy finalization
- migration guide for Convex users
- final cleanup and API notes

Exit Criteria:

- edge-compatible release candidate cut
- migration and compatibility docs published

## Workstream Breakdown by Team/Agent

### Workstream A - Architecture and Contracts

- produce and maintain compatibility/security contracts
- approve behavior changes and deprecations

### Workstream B - Crypto and Key Handling

- implement Oslo/WebCrypto wrappers
- maintain algorithm policy and key import reliability

### Workstream C - XMLDSig and C14N

- implement canonicalization and transform logic
- own signature verification/signing correctness

### Workstream D - XML Encryption

- own encryption/decryption behavior and policy defaults
- implement encrypted assertion parity tests

### Workstream E - Protocol Integration

- wire internals into request/response builders
- maintain metadata parser/generator compatibility

### Workstream F - Security and QA

- maintain adversarial vector suite
- own security gate and release block conditions

## Required Test Matrix

### Unit Coverage

- canonicalization behavior by namespace and attribute ordering
- reference extraction and URI handling
- signature digest verification behavior
- key parsing and import behavior

### Property/Invariant Tests

- canonicalization determinism
- signature stability under equivalent XML forms

### Differential Tests

- compare old/new outputs where behavior should match upstream

### Adversarial Tests

- signature wrapping attempts
- duplicate ID collisions
- mismatched digest and signature values
- wrong audience/destination
- wrong inResponseTo
- assertion time window violations

### Interop Tests

- provider fixtures for major enterprise IdPs
- signed response only
- signed assertion only
- both signed
- encrypted assertion cases

## CI and Quality Gates

- typecheck
- lint
- runtime forbidden import scanner
- full test suite
- security suite
- interop fixture suite (nightly if expensive)

No milestone can merge without passing all gates required for its scope.

## Risks and Mitigations

1. Canonicalization correctness drift

- Mitigation: fixture-heavy C14N test corpus and differential tests.

2. Hidden dependency on Node-only behavior

- Mitigation: static forbidden-import guard and runtime smoke tests.

3. XML encryption parity complexity

- Mitigation: isolated workstream with dedicated fixtures and strict scope.

4. API compatibility regressions

- Mitigation: contract tests from `COMPATIBILITY_SPEC.md`.

5. Security regressions under edge case payloads

- Mitigation: required adversarial suite as release blocker.

## Decision Log Requirements

Maintain `DECISIONS.md` with immutable entries:

- decision id
- date
- context
- chosen option
- rejected alternatives
- expected impact

This is required for long-running agent handoffs.

## Branching and Merge Rules

- long-lived branch: `edge-runtime-core`
- feature branch prefix: `edge/<milestone>-<topic>`
- no direct commits to `master`
- no force-push to protected branches
- no upstream pushes ever

## Immediate Next Tasks (For the Next Agent)

1. Create `COMPATIBILITY_SPEC.md` from current exports and observed behavior.
2. Create `SECURITY_REQUIREMENTS.md` with pass/fail criteria.
3. Build dependency inventory with every Node builtin touchpoint.
4. Propose Bun workspace file layout and migration diff plan.
5. Implement CI guardrail for forbidden runtime imports.

## Agent Handoff Prompt (Copy/Paste)

Use this exact mission framing:

"You are working in `/Users/estifanos/Documents/dev/samlify` on
`robelest/samlify`. This fork is private strategy work and must never be pushed
to upstream (`tngan/samlify`). Build edge-runtime parity with SAMLify while
preserving API compatibility. Follow `docs/EDGE_RUNTIME_PARITY_PLAN.md`.
Complete M0 first with formal compatibility and security contracts, then proceed
milestone by milestone with CI and security gates. Do not introduce Node builtin
dependencies into runtime packages. Prefer Oslo + WebCrypto primitives."
