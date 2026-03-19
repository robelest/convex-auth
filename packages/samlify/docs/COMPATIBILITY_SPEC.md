# COMPATIBILITY_SPEC.md

## Purpose

Define the compatibility contract for the edge-runtime fork of `samlify`. This
is the baseline for M0 and the reference for all later milestones.

Scope of this document:

- Public exports and callable API surface.
- Default behavior and option precedence.
- Output and error contracts for core login/logout flows.
- Backward compatibility rules for migration work.

Out of scope:

- Internal implementation details that are not observable by users.
- Runtime-specific performance targets.

## Baseline

- Baseline source: current repository state in
  `/Users/estifanos/Documents/dev/samlify`.
- Language/runtime baseline: TypeScript build targeting ES5/CommonJS.
- Primary behavior baseline is defined by `src/*` and current `test/*`
  expectations.

## Public API Surface

From `index.ts`, the compatibility facade exports:

- `IdentityProvider` (factory function)
- `IdentityProviderInstance` (class alias)
- `ServiceProvider` (factory function)
- `ServiceProviderInstance` (class alias)
- `IdPMetadata`
- `SPMetadata`
- `Utility`
- `SamlLib`
- `Constants`
- `Extractor`
- `setSchemaValidator`
- `setDOMParserOptions`

Any edge rewrite MUST preserve these export names and import paths.

## Construction and Input Contracts

### Entity constructors

- `IdentityProvider(props)` and `ServiceProvider(props)` MUST remain callable as
  factories.
- Class constructors MUST remain available via `IdentityProviderInstance` and
  `ServiceProviderInstance`.
- Metadata input MUST continue to support XML content as `string | Buffer`.
- Object-based metadata generation (`IdPMetadata`, `SPMetadata`) MUST continue
  to work.

### Global context APIs

- `setSchemaValidator({ validate })` MUST accept an object with a
  `validate(xml)` function.
- `setDOMParserOptions(options)` MUST continue to customize parser options
  globally.

### Metadata read/write behavior

- `getMetadata()` MUST return XML string.
- `exportMetadata(path)` currently writes to filesystem and is part of
  compatibility baseline.
- During edge migration, filesystem use must move behind adapters, but public
  method must remain.

## Default Option Semantics

Current defaults in `Entity` MUST remain unless explicitly versioned:

- `wantLogoutResponseSigned: false`
- `messageSigningOrder: sign-then-encrypt`
- `wantLogoutRequestSigned: false`
- `allowCreate: false`
- `isAssertionEncrypted: false`
- `requestSignatureAlgorithm: RSA_SHA256`
- `dataEncryptionAlgorithm: AES_256`
- `keyEncryptionAlgorithm: RSA_OAEP_MGF1P`
- `generateID: '_' + uuid.v4()`
- `relayState: ''`

Additional defaults:

- Service Provider defaults: `authnRequestsSigned: false`,
  `wantAssertionsSigned: false`, `wantMessageSigned: false`.
- Identity Provider default: `wantAuthnRequestsSigned: false`,
  `tagPrefix.encryptedAssertion: 'saml'`.

Option precedence contract:

- Constructor settings are merged with defaults.
- Metadata-derived values may override selected settings (for request/response
  signing flags and NameID formats).

## Flow and Output Contracts

### SP outbound

- `sp.createLoginRequest(idp, binding, customTagReplacement?)` supports
  `redirect`, `post`, `simpleSign`.
- Return shape includes at least `id` and `context`.
- For `post` and `simpleSign`, return also includes `relayState`,
  `entityEndpoint`, `type: 'SAMLRequest'`.
- For `simpleSign`, return may include `signature` and `sigAlg`.

### IdP outbound

- `idp.createLoginResponse(sp, requestInfo, binding, user, customTagReplacement?, encryptThenSign?, relayState?)`
  supports `post`, `redirect`, `simpleSign`.
- Return shape includes binding-specific context; non-redirect includes
  `relayState`, `entityEndpoint`, `type: 'SAMLResponse'`.

### Parsing

- `idp.parseLoginRequest(sp, binding, req)` parses SP AuthnRequest.
- `sp.parseLoginResponse(idp, binding, req)` parses IdP SAMLResponse.
- `parseLogoutRequest` / `parseLogoutResponse` behavior from `Entity` must
  remain available.

`FlowResult` compatibility shape:

- `samlContent: string`
- `extract: any`
- `sigAlg?: string | null`

## Signature and Validation Behavior

The following observable behavior is part of baseline compatibility:

- Redirect and SimpleSign flows verify detached message signatures when
  required.
- POST flow verifies XML signatures from response/request documents.
- Signature wrapping checks are present and must continue to reject wrapping
  vectors.
- XML validation uses global validator hook from `setSchemaValidator`.
- Missing validator currently causes rejection; equivalent fail-closed behavior
  must remain.

## Error and Rejection Contract

Current contract is mixed and must be preserved short-term:

- Some failures throw `Error('ERR_*')`.
- Some async flows reject with string codes (for example
  `ERR_SUBJECT_UNCONFIRMED`).

Representative stable codes used by tests and callers include:

- `ERR_METADATA_CONFLICT_REQUEST_SIGNED_FLAG`
- `ERR_CREATE_RESPONSE_UNDEFINED_BINDING`
- `ERR_CREATE_LOGOUT_RESPONSE_UNDEFINED_BINDING`
- `ERR_POTENTIAL_WRAPPING_ATTACK`
- `ERR_NO_ASSERTION`
- `ERR_UNDEFINED_ASSERTION`
- `ERR_MULTIPLE_METADATA_ENTITYDESCRIPTOR`
- `ERR_FAILED_STATUS with top tier code: ...`

Migration rule:

- Do not silently rename or remove existing error codes.
- If error normalization is introduced later, preserve legacy codes behind
  compatibility mapping.

## Backward Compatibility Rules

1. Keep root exports and entity factory call signatures stable.
2. Keep binding names and accepted values stable (`redirect`, `post`,
   `simpleSign`).
3. Keep metadata generation/parsing behavior compatible with existing fixtures.
4. Keep default signing/encryption algorithms unless explicitly version-gated.
5. Keep output object keys and field meaning stable.

## Known Compatibility Gaps to Track

- Current code mixes string rejections and `Error` throws.
- Some legacy Node-specific options (`keyFile`, filesystem exports) need adapter
  layers in edge runtime.
- URL parsing currently relies on Node `url.parse` behavior.

These are migration constraints, not immediate breaking changes.

## Verification Sources

Primary baseline sources:

- `index.ts`
- `src/entity.ts`, `src/entity-idp.ts`, `src/entity-sp.ts`
- `src/flow.ts`, `src/binding-post.ts`, `src/binding-redirect.ts`,
  `src/binding-simplesign.ts`
- `src/libsaml.ts`, `src/metadata*.ts`
- `test/index.ts`, `test/flow.ts`, `test/issues.ts`, `test/extractor.ts`
