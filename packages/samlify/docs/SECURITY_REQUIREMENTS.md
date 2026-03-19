# SECURITY_REQUIREMENTS.md

## Purpose

Define mandatory security requirements for the edge-runtime parity fork. This
document is the acceptance contract for security gates in M0-M11.

Requirement language:

- MUST: mandatory for merge/release.
- SHOULD: strongly recommended, allowed temporary exception with decision log.
- MAY: optional.

## Threat Model

Primary threats to address:

- XML Signature wrapping and reference confusion.
- Signature bypass via algorithm downgrade or weak verification paths.
- Assertion replay and request correlation failures.
- Audience/destination mismatch acceptance.
- Time-window bypass (NotBefore / NotOnOrAfter / SessionNotOnOrAfter).
- Unsafe decryption/signature combinations and insecure algorithm defaults.

## Security Requirements

### XML validation and parsing

SEC-XML-001 (MUST)

- All inbound SAML XML MUST pass configured schema/validator checks before trust
  decisions.
- If no validator is configured, parsing MUST fail closed.

SEC-XML-002 (MUST)

- XML parser behavior MUST be deterministic across supported runtimes.
- Parser configuration changes via `setDOMParserOptions` MUST not disable core
  security checks.

### Signature verification hardening

SEC-SIG-001 (MUST)

- Verification MUST bind to the signed node used for extraction and business
  decisions.
- Extraction of issuer, subject, conditions, and attributes MUST come from
  verified content.

SEC-SIG-002 (MUST)

- Implement strict reference URI resolution and enforce exactly one valid signed
  target per expected context.

SEC-SIG-003 (MUST)

- Enforce unique ID policy for signed targets and reject duplicate IDs.

SEC-SIG-004 (MUST)

- Signature wrapping patterns MUST be rejected.

SEC-SIG-005 (MUST)

- Signature verification MUST use trusted keys from configured metadata/cert
  sources only.
- Embedded cert acceptance MUST be constrained by metadata trust anchors.

### Algorithm policy

SEC-ALG-001 (MUST)

- Signature and digest algorithms MUST be allowlisted.
- Disabled or unknown algorithms MUST be rejected.

SEC-ALG-002 (MUST)

- Insecure/deprecated algorithms MUST be disabled by default.
- Any insecure compatibility mode MUST require explicit opt-in with clear
  warning.

SEC-ALG-003 (SHOULD)

- Provide policy object for administrators to customize allowlists per
  deployment.

### Protocol validation

SEC-PROTO-001 (MUST)

- `Issuer` MUST match expected metadata entity ID for trusted counterpart.

SEC-PROTO-002 (MUST)

- `Destination` MUST match expected ACS/SLO endpoint for the receiving entity.

SEC-PROTO-003 (MUST)

- `Audience` MUST contain the receiving SP entity ID for login responses.

SEC-PROTO-004 (MUST)

- `InResponseTo` MUST be validated against expected request ID where flow
  requires correlation.

SEC-PROTO-005 (MUST)

- Response status validation MUST fail on non-success status, preserving current
  top/second-tier reporting.

### Time and session validity

SEC-TIME-001 (MUST)

- Validate assertion condition window (`NotBefore`, `NotOnOrAfter`) with
  explicit drift policy.

SEC-TIME-002 (MUST)

- Validate session window (`SessionNotOnOrAfter`) when present.

SEC-TIME-003 (SHOULD)

- Drift policy MUST be explicit, bounded, and auditable.

### Encryption and key handling

SEC-ENC-001 (MUST)

- Encryption/decryption algorithms MUST follow allowlist policy and secure
  defaults.

SEC-ENC-002 (MUST)

- Key parsing/import MUST reject malformed or ambiguous key material.

SEC-ENC-003 (MUST)

- Decryption errors MUST fail closed and MUST NOT fall back to insecure
  plaintext assumptions.

SEC-ENC-004 (SHOULD)

- Do not log plaintext assertions, private keys, or raw decrypted sensitive
  material.

### Replay protection

SEC-REPLAY-001 (MUST)

- Provide replay-protection hook contract for request/response IDs and session
  identifiers.

SEC-REPLAY-002 (MUST)

- Replay hooks MUST be called before accepting authentication success.

### Error handling and observability

SEC-ERR-001 (MUST)

- Security failures MUST fail closed.
- Do not continue processing after signature, status, time, or trust failures.

SEC-ERR-002 (SHOULD)

- Normalize errors to stable codes while preserving backward compatibility
  mapping.

SEC-LOG-001 (SHOULD)

- Logs SHOULD include high-level failure reason and code but avoid sensitive
  payload leakage.

## Runtime Security Constraints (Edge Plan)

RUNTIME-001 (MUST)

- Runtime packages MUST NOT import Node builtins (`fs`, `path`, `url`, `crypto`,
  `stream`, etc.).

RUNTIME-002 (MUST)

- Cryptographic primitives MUST rely on WebCrypto and approved edge-safe
  wrappers.

RUNTIME-003 (MUST)

- Runtime code MUST avoid filesystem assumptions for metadata, templates, certs,
  and keys.

## Acceptance Evidence

Each milestone must include evidence for the requirements in scope:

- Unit tests for algorithm/reference/path validation.
- Adversarial tests for wrapping, duplicate IDs, tampered digest/signature.
- Protocol tests for issuer/audience/destination/inResponseTo.
- Time-window tests with and without drift.
- Interop fixture tests for signed/encrypted variants.

Final security gate deliverable:

- `SECURITY_GATE_REPORT.md` with requirement-by-requirement pass/fail evidence.

## Current Baseline Notes

Current code already includes partial protections (for example wrapping checks
and time checks), but this document is normative for the migration target.

Any temporary exception MUST be documented in `DECISIONS.md` with expiry
criteria.
