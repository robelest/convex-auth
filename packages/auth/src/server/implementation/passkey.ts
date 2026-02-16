/**
 * Server-side WebAuthn ceremony logic for passkey authentication.
 *
 * Handles the four phases of the WebAuthn flow:
 * 1. register-options — generate PublicKeyCredentialCreationOptions
 * 2. register-verify — verify attestation and store credential
 * 3. auth-options — generate PublicKeyCredentialRequestOptions
 * 4. auth-verify — verify assertion signature and sign in
 *
 * Uses `@oslojs/webauthn` for attestation/assertion parsing and
 * `@oslojs/crypto` for signature verification.
 */

import {
  parseAttestationObject,
  parseClientDataJSON,
  parseAuthenticatorData,
  createAssertionSignatureMessage,
  ClientDataType,
  coseAlgorithmES256,
  coseAlgorithmRS256,
  COSEKeyType,
} from "@oslojs/webauthn";
import {
  p256,
  verifyECDSASignature,
  decodeSEC1PublicKey,
  decodePKIXECDSASignature,
} from "@oslojs/crypto/ecdsa";
import {
  RSAPublicKey,
  decodePKCS1RSAPublicKey,
  sha256ObjectIdentifier,
  verifyRSASSAPKCS1v15Signature,
} from "@oslojs/crypto/rsa";
import { sha256 } from "@oslojs/crypto/sha2";
import {
  encodeBase64urlNoPadding,
  decodeBase64urlIgnorePadding,
} from "@oslojs/encoding";
import {
  PasskeyProviderConfig,
  GenericActionCtxWithAuthConfig,
} from "../types";
import {
  AuthDataModel,
  SessionInfo,
  queryUserById,
  queryUserByVerifiedEmail,
  queryPasskeysByUserId,
  queryPasskeyByCredentialId,
  queryVerifierById,
  mutatePasskeyInsert,
  mutatePasskeyUpdateCounter,
  mutateVerifierDelete,
} from "./types";
import { callSignIn, callVerifier } from "./mutations/index";
import { callVerifierSignature } from "./mutations/signature";
import { authDb } from "./db";
import { throwAuthError } from "../errors";


type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

/**
 * Resolve passkey relying party options from provider config and environment.
 */
function resolveRpOptions(provider: PasskeyProviderConfig) {
  // WebAuthn RP ID and origin must match the *frontend* domain, not the
  // Convex backend.  SITE_URL is the canonical frontend URL
  // (e.g. "http://localhost:3000" in dev, "https://myapp.com" in prod).
  // CONVEX_SITE_URL points to the Convex cloud HTTP actions endpoint and
  // must NOT be used here — the browser would reject the credential
  // because the RP ID wouldn't match the page origin.
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl && !provider.options.rpId) {
    throwAuthError(
      "PASSKEY_MISSING_CONFIG",
      "Passkey provider requires SITE_URL env var (your frontend URL) " +
      "or explicit rpId / origin in the provider config. " +
      "CONVEX_SITE_URL cannot be used because WebAuthn RP ID must match the frontend domain.",
    );
  }
  const siteHostname = siteUrl ? new URL(siteUrl).hostname : undefined;

  return {
    rpName: provider.options.rpName ?? siteHostname ?? "localhost",
    rpId: provider.options.rpId ?? siteHostname ?? "localhost",
    origin: provider.options.origin ?? siteUrl ?? "http://localhost",
    attestation: provider.options.attestation ?? "none",
    userVerification: provider.options.userVerification ?? "required",
    residentKey: provider.options.residentKey ?? "preferred",
    authenticatorAttachment: provider.options.authenticatorAttachment,
    algorithms: provider.options.algorithms ?? [coseAlgorithmES256, coseAlgorithmRS256],
    challengeExpirationMs: provider.options.challengeExpirationMs ?? 300_000,
  };
}

/**
 * Generate a cryptographically random challenge.
 */
function generateChallenge(): Uint8Array {
  const challenge = new Uint8Array(32);
  crypto.getRandomValues(challenge);
  return challenge;
}

/**
 * Hash a challenge for storage in the verifier table's `signature` field.
 */
function hashChallenge(challenge: Uint8Array): string {
  return encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));
}

// ============================================================================
// Registration flow
// ============================================================================

/**
 * Phase 1: Generate registration options.
 *
 * Requires an authenticated user — passkey registration always adds a
 * credential to an existing account.  The userId is taken from the
 * current session identity.
 */
async function handleRegisterOptions(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  params: Record<string, any>,
): Promise<{
  kind: "passkeyOptions";
  options: Record<string, any>;
  verifier: string;
}> {
  // Passkey registration requires an authenticated user
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throwAuthError("PASSKEY_AUTH_REQUIRED");
  }
  const [userId] = identity.subject.split("|");

  const rp = resolveRpOptions(provider);
  const challenge = generateChallenge();
  const challengeHash = hashChallenge(challenge);

  // Store the challenge hash in the verifier table
  const verifier = await callVerifier(ctx);
  await callVerifierSignature(ctx, {
    verifier,
    signature: challengeHash,
  });

  // Get the user's profile for credential metadata
  const user = await queryUserById(ctx, userId!);
  const userName = params.userName ?? user?.email ?? "user";
  const userDisplayName = params.userDisplayName ?? user?.name ?? userName;

  // Collect existing credentials to prevent re-registration
  const existing = await queryPasskeysByUserId(ctx, userId!);
  const excludeCredentials = existing.map((pk) => ({
    id: pk.credentialId,
    transports: pk.transports,
  }));

  // User handle is derived from the Convex userId
  const userHandle = encodeBase64urlNoPadding(
    new TextEncoder().encode(userId!),
  );

  const options = {
    rp: {
      name: rp.rpName,
      id: rp.rpId,
    },
    user: {
      id: userHandle,
      name: userName,
      displayName: userDisplayName,
    },
    challenge: encodeBase64urlNoPadding(challenge),
    pubKeyCredParams: rp.algorithms.map((alg) => ({
      type: "public-key" as const,
      alg,
    })),
    timeout: rp.challengeExpirationMs,
    attestation: rp.attestation,
    authenticatorSelection: {
      residentKey: rp.residentKey,
      requireResidentKey: rp.residentKey === "required",
      userVerification: rp.userVerification,
      ...(rp.authenticatorAttachment
        ? { authenticatorAttachment: rp.authenticatorAttachment }
        : {}),
    },
    excludeCredentials,
  };

  return { kind: "passkeyOptions", options, verifier };
}

/**
 * Phase 2: Verify registration attestation and store the credential.
 *
 * Requires an authenticated user.  Parses the attestation, verifies the
 * challenge, extracts the public key, creates an account + passkey record
 * linked to the current user, and returns auth tokens.
 */
async function handleRegisterVerify(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  params: Record<string, any>,
  verifierValue: string | undefined,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  // Passkey registration requires an authenticated user
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throwAuthError("PASSKEY_AUTH_REQUIRED");
  }
  const [userId] = identity.subject.split("|");

  const rp = resolveRpOptions(provider);

  if (!verifierValue) {
    throwAuthError("PASSKEY_MISSING_VERIFIER");
  }

  // Decode client data
  const clientDataJSON = decodeBase64urlIgnorePadding(params.clientDataJSON);
  const clientData = parseClientDataJSON(clientDataJSON);

  // Verify client data type is "webauthn.create"
  if (clientData.type !== ClientDataType.Create) {
    throwAuthError("PASSKEY_INVALID_CLIENT_DATA", "Invalid client data type: expected webauthn.create");
  }

  // Verify origin
  const allowedOrigins = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
  if (!allowedOrigins.includes(clientData.origin)) {
    throwAuthError(
      "PASSKEY_INVALID_ORIGIN",
      `Invalid origin: ${clientData.origin}, expected one of: ${allowedOrigins.join(", ")}`,
    );
  }

  // Verify challenge matches the stored verifier
  const challengeHash = encodeBase64urlNoPadding(
    new Uint8Array(sha256(clientData.challenge)),
  );
  const verifierDoc = await queryVerifierById(ctx, verifierValue);
  if (!verifierDoc || verifierDoc.signature !== challengeHash) {
    throwAuthError("PASSKEY_INVALID_CHALLENGE");
  }

  // Clean up the verifier
  await mutateVerifierDelete(ctx, verifierValue);

  // Parse attestation object
  const attestationObjectBytes = decodeBase64urlIgnorePadding(params.attestationObject);
  const attestation = parseAttestationObject(attestationObjectBytes);
  const authenticatorData = attestation.authenticatorData;

  // Verify RP ID hash
  if (!authenticatorData.verifyRelyingPartyIdHash(rp.rpId)) {
    throwAuthError("PASSKEY_RP_MISMATCH");
  }

  // Verify user presence and verification flags
  if (!authenticatorData.userPresent) {
    throwAuthError("PASSKEY_USER_PRESENCE");
  }
  if (rp.userVerification === "required" && !authenticatorData.userVerified) {
    throwAuthError("PASSKEY_USER_VERIFICATION");
  }

  // Extract credential
  const credential = authenticatorData.credential;
  if (!credential) {
    throwAuthError("PASSKEY_NO_CREDENTIAL");
  }

  const credentialId = encodeBase64urlNoPadding(credential.id);
  const publicKey = credential.publicKey;

  // Determine algorithm and encode the public key for storage
  let algorithm: number;
  let publicKeyBytes: Uint8Array;

  if (publicKey.isAlgorithmDefined()) {
    algorithm = publicKey.algorithm();
  } else {
    const keyType = publicKey.type();
    algorithm =
      keyType === COSEKeyType.EC2
        ? coseAlgorithmES256
        : keyType === COSEKeyType.RSA
          ? coseAlgorithmRS256
          : coseAlgorithmES256;
  }

  if (algorithm === coseAlgorithmES256) {
    const ec2 = publicKey.ec2();
    // Encode as SEC1 uncompressed point (0x04 || x || y)
    const xBytes = bigintToBytes(ec2.x, 32);
    const yBytes = bigintToBytes(ec2.y, 32);
    publicKeyBytes = new Uint8Array(65);
    publicKeyBytes[0] = 0x04;
    publicKeyBytes.set(xBytes, 1);
    publicKeyBytes.set(yBytes, 33);
  } else if (algorithm === coseAlgorithmRS256) {
    const rsa = publicKey.rsa();
    const rsaPubKey = new RSAPublicKey(rsa.n, rsa.e);
    publicKeyBytes = rsaPubKey.encodePKCS1();
  } else {
    throwAuthError("PASSKEY_UNSUPPORTED_ALGORITHM", `Unsupported algorithm: ${algorithm}`);
  }

  const deviceType = params.deviceType ?? "single-device";
  const backedUp = params.backedUp ?? false;

  // Create an account record linking the passkey to the current user.
  // Unlike unauthenticated flows, we don't create a new user — we
  // attach the passkey credential to the existing authenticated user.
  const db = authDb(ctx, ctx.auth.config);
  await db.accounts.create({
    userId: userId!,
    provider: provider.id,
    providerAccountId: credentialId,
  });

  // Store the passkey credential
  await mutatePasskeyInsert(ctx, {
    userId: userId!,
    credentialId,
    publicKey: publicKeyBytes.buffer.slice(
      publicKeyBytes.byteOffset,
      publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
    ),
    algorithm,
    counter: authenticatorData.signatureCounter,
    transports: params.transports,
    deviceType,
    backedUp,
    name: params.passkeyName,
    createdAt: Date.now(),
  });

  // Return tokens for the existing session
  const signInResult = await callSignIn(ctx, {
    userId: userId!,
    generateTokens: true,
  });

  return { kind: "signedIn", signedIn: signInResult };
}

// ============================================================================
// Authentication flow
// ============================================================================

/**
 * Phase 3: Generate authentication options.
 *
 * Creates a challenge and returns PublicKeyCredentialRequestOptions.
 * If an email is provided, scopes allowCredentials to that user's passkeys.
 */
async function handleAuthOptions(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  params: Record<string, any>,
): Promise<{
  kind: "passkeyOptions";
  options: Record<string, any>;
  verifier: string;
}> {
  const rp = resolveRpOptions(provider);
  const challenge = generateChallenge();
  const challengeHash = hashChallenge(challenge);

  // Store the challenge hash in the verifier table
  const verifier = await callVerifier(ctx);
  await callVerifierSignature(ctx, {
    verifier,
    signature: challengeHash,
  });

  // Build allowCredentials if email is provided
  let allowCredentials: Array<{ type: string; id: string; transports?: string[] }> | undefined;
  if (params.email) {
    // Look up user by email, then find their passkeys
    const user = await queryUserByVerifiedEmail(ctx, params.email);
    if (user) {
      const passkeys = await queryPasskeysByUserId(ctx, user._id);
      if (passkeys.length > 0) {
        allowCredentials = passkeys.map((pk) => ({
          type: "public-key",
          id: pk.credentialId,
          transports: pk.transports,
        }));
      }
    }
  }

  const options: Record<string, any> = {
    challenge: encodeBase64urlNoPadding(challenge),
    timeout: rp.challengeExpirationMs,
    rpId: rp.rpId,
    userVerification: rp.userVerification,
  };

  if (allowCredentials) {
    options.allowCredentials = allowCredentials;
  }

  return { kind: "passkeyOptions", options, verifier };
}

/**
 * Phase 4: Verify authentication assertion and sign in.
 *
 * Verifies the signature against the stored public key, checks the counter,
 * and creates a session.
 */
async function handleAuthVerify(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  params: Record<string, any>,
  verifierValue: string | undefined,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  const rp = resolveRpOptions(provider);

  if (!verifierValue) {
    throwAuthError("PASSKEY_MISSING_VERIFIER");
  }

  // Decode client data
  const clientDataJSON = decodeBase64urlIgnorePadding(params.clientDataJSON);
  const clientData = parseClientDataJSON(clientDataJSON);

  // Verify client data type is "webauthn.get"
  if (clientData.type !== ClientDataType.Get) {
    throwAuthError("PASSKEY_INVALID_CLIENT_DATA", "Invalid client data type: expected webauthn.get");
  }

  // Verify origin
  const allowedOrigins = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
  if (!allowedOrigins.includes(clientData.origin)) {
    throwAuthError(
      "PASSKEY_INVALID_ORIGIN",
      `Invalid origin: ${clientData.origin}, expected one of: ${allowedOrigins.join(", ")}`,
    );
  }

  // Verify challenge matches the stored verifier
  const challengeHash = encodeBase64urlNoPadding(
    new Uint8Array(sha256(clientData.challenge)),
  );
  const verifierDoc = await queryVerifierById(ctx, verifierValue);
  if (!verifierDoc || verifierDoc.signature !== challengeHash) {
    throwAuthError("PASSKEY_INVALID_CHALLENGE");
  }

  // Clean up the verifier
  await mutateVerifierDelete(ctx, verifierValue);

  // Look up the credential
  const credentialId = params.credentialId;
  if (!credentialId) {
    throwAuthError("PASSKEY_UNKNOWN_CREDENTIAL", "Missing credential ID");
  }

  const passkey = await queryPasskeyByCredentialId(ctx, credentialId);
  if (!passkey) {
    throwAuthError("PASSKEY_UNKNOWN_CREDENTIAL", "Unknown credential");
  }

  // Parse authenticator data
  const authenticatorDataBytes = decodeBase64urlIgnorePadding(params.authenticatorData);
  const authenticatorData = parseAuthenticatorData(authenticatorDataBytes);

  // Verify RP ID hash
  if (!authenticatorData.verifyRelyingPartyIdHash(rp.rpId)) {
    throwAuthError("PASSKEY_RP_MISMATCH");
  }

  // Verify user presence
  if (!authenticatorData.userPresent) {
    throwAuthError("PASSKEY_USER_PRESENCE");
  }
  if (rp.userVerification === "required" && !authenticatorData.userVerified) {
    throwAuthError("PASSKEY_USER_VERIFICATION");
  }

  // Verify signature
  const signature = decodeBase64urlIgnorePadding(params.signature);
  const signatureMessage = createAssertionSignatureMessage(
    authenticatorDataBytes,
    clientDataJSON,
  );
  const messageHash = sha256(signatureMessage);

  const storedPublicKeyBytes = new Uint8Array(passkey.publicKey);

  if (passkey.algorithm === coseAlgorithmES256) {
    // EC P-256 verification
    const ecPublicKey = decodeSEC1PublicKey(p256, storedPublicKeyBytes);
    // WebAuthn signatures for EC keys are DER/ASN.1 (PKIX) encoded
    const ecdsaSignature = decodePKIXECDSASignature(signature);
    const valid = verifyECDSASignature(
      ecPublicKey,
      messageHash,
      ecdsaSignature,
    );
    if (!valid) {
      throwAuthError("PASSKEY_INVALID_SIGNATURE");
    }
  } else if (passkey.algorithm === coseAlgorithmRS256) {
    // RSA PKCS#1 v1.5 with SHA-256 verification
    // Decode the stored PKCS#1 public key
    const rsaPublicKey = decodePKCS1RSAPublicKey(storedPublicKeyBytes);
    const valid = verifyRSASSAPKCS1v15Signature(
      rsaPublicKey,
      sha256ObjectIdentifier,
      messageHash,
      signature,
    );
    if (!valid) {
      throwAuthError("PASSKEY_INVALID_SIGNATURE");
    }
  } else {
    throwAuthError("PASSKEY_UNSUPPORTED_ALGORITHM", `Unsupported algorithm: ${passkey.algorithm}`);
  }

  // Verify counter (clone detection)
  // Counter of 0 means the authenticator doesn't support counters
  if (
    passkey.counter !== 0 &&
    authenticatorData.signatureCounter !== 0 &&
    authenticatorData.signatureCounter <= passkey.counter
  ) {
    throwAuthError("PASSKEY_COUNTER_ERROR");
  }

  // Update counter and last used timestamp
  await mutatePasskeyUpdateCounter(
    ctx,
    passkey._id,
    authenticatorData.signatureCounter,
    Date.now(),
  );

  // Sign in the user
  const signInResult = await callSignIn(ctx, {
    userId: passkey.userId,
    generateTokens: true,
  });

  return { kind: "signedIn", signedIn: signInResult };
}

// ============================================================================
// Main dispatch
// ============================================================================

/**
 * Main passkey handler dispatched from signIn.ts.
 *
 * Routes to the appropriate phase based on `params.flow`.
 */
export async function handlePasskey(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  args: {
    params?: Record<string, any>;
    verifier?: string;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string }
> {
  const flow = args.params?.flow;
  if (!flow) {
    throwAuthError(
      "PASSKEY_MISSING_FLOW",
      "Missing `flow` parameter. Expected one of: register-options, register-verify, auth-options, auth-verify",
    );
  }

  switch (flow) {
    case "register-options":
      return handleRegisterOptions(ctx, provider, args.params ?? {});
    case "register-verify":
      return handleRegisterVerify(ctx, provider, args.params ?? {}, args.verifier);
    case "auth-options":
      return handleAuthOptions(ctx, provider, args.params ?? {});
    case "auth-verify":
      return handleAuthVerify(ctx, provider, args.params ?? {}, args.verifier);
    default:
      throwAuthError(
        "PASSKEY_UNKNOWN_FLOW",
        `Unknown passkey flow: ${flow}. Expected one of: register-options, register-verify, auth-options, auth-verify`,
      );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a bigint to a fixed-size big-endian byte array.
 */
function bigintToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}
