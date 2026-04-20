/**
 * Server-side WebAuthn ceremony logic for passkey authentication.
 *
 * Handles the four phases of the WebAuthn flow:
 * 1. registerOptions — generate PublicKeyCredentialCreationOptions
 * 2. registerVerify — verify attestation and store credential
 * 3. authOptions — generate PublicKeyCredentialRequestOptions
 * 4. authVerify — verify assertion signature and sign in
 *
 * Uses `@oslojs/webauthn` for attestation/assertion parsing and
 * `@oslojs/crypto` for signature verification.
 *
 * @module
 */

import {
  decodePKIXECDSASignature,
  decodeSEC1PublicKey,
  p256,
  verifyECDSASignature,
} from "@oslojs/crypto/ecdsa";
import {
  decodePKCS1RSAPublicKey,
  RSAPublicKey,
  sha256ObjectIdentifier,
  verifyRSASSAPKCS1v15Signature,
} from "@oslojs/crypto/rsa";
import { sha256 } from "@oslojs/crypto/sha2";
import { decodeBase64urlIgnorePadding, encodeBase64urlNoPadding } from "@oslojs/encoding";
import {
  ClientDataType,
  coseAlgorithmES256,
  coseAlgorithmRS256,
  COSEKeyType,
  createAssertionSignatureMessage,
  parseAttestationObject,
  parseAuthenticatorData,
  parseClientDataJSON,
} from "@oslojs/webauthn";

import type {
  AuthTokens,
  SignInPasskeyOptionsResult,
  SignInSessionResult,
} from "../shared/authResults";
import { ConvexError } from "convex/values";

import { authFlowError } from "../shared/errors";
import { authDb } from "./db";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { getAuthenticatedUserIdOrNull } from "./identity";
import { callSignIn, callVerifier } from "./mutations/index";
import { GenericActionCtxWithAuthConfig, PasskeyProviderConfig } from "./types";
import {
  AuthDataModel,
  mutatePasskeyInsert,
  mutatePasskeyUpdateCounter,
  mutateVerifierDelete,
  queryPasskeyByCredentialId,
  queryPasskeysByUserId,
  queryUserById,
  queryUserByVerifiedEmail,
  queryVerifierById,
  SessionInfo,
} from "./types";
import { siteUrlsFromEnv } from "./url";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

interface RpOptions {
  rpName: string;
  rpId: string;
  origin: string | string[];
  attestation: string;
  userVerification: string;
  residentKey: string;
  authenticatorAttachment?: string;
  algorithms: number[];
  challengeExpirationMs: number;
}

type PasskeyResult =
  | SignInSessionResult<SessionInfo<AuthTokens | null> | null>
  | SignInPasskeyOptionsResult;

const PASSKEY_FLOW = {
  registerOptions: "registerOptions",
  registerVerify: "registerVerify",
  authOptions: "authOptions",
  authVerify: "authVerify",
} as const;

const PASSKEY_FLOWS = [
  PASSKEY_FLOW.registerOptions,
  PASSKEY_FLOW.registerVerify,
  PASSKEY_FLOW.authOptions,
  PASSKEY_FLOW.authVerify,
] as const;

type PasskeyDispatch =
  | { flow: typeof PASSKEY_FLOW.registerOptions }
  | { flow: typeof PASSKEY_FLOW.registerVerify }
  | { flow: typeof PASSKEY_FLOW.authOptions }
  | { flow: typeof PASSKEY_FLOW.authVerify };

type PasskeyParams = {
  userName?: string;
  userDisplayName?: string;
  email?: string;
  clientDataJSON?: string;
  attestationObject?: string;
  deviceType?: string;
  backedUp?: boolean;
  transports?: string[];
  passkeyName?: string;
  credentialId?: string;
  authenticatorData?: string;
  signature?: string;
};

const requireStringParam = (value: unknown, name: string) => {
  if (typeof value !== "string") {
    throw convexError("INVALID_PARAMETERS", `Missing \`${name}\` parameter.`);
  }
  return value;
};

const convexError = (code: string, message: string) => toConvexError(authFlowError(code, message));

const asConvexError = (error: unknown, code: string, message: string): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? error
    : error instanceof Error
      ? toConvexError(authFlowError(code, error.message || message))
      : convexError(code, message);

function resolveRpOptions(provider: PasskeyProviderConfig): RpOptions {
  try {
    const configuredSiteUrls = process.env.SITE_URL === undefined ? null : siteUrlsFromEnv();
    const siteUrl = configuredSiteUrls?.primaryUrl;
    const hasSiteUrl = siteUrl !== undefined && siteUrl !== "";
    const hasRpId = provider.options.rpId !== undefined;

    if (!hasSiteUrl && !hasRpId) {
      throw convexError(
        "PASSKEY_MISSING_CONFIG",
        "Passkey provider requires SITE_URL env var (your frontend URL) or explicit rpId / origin in the provider config. CONVEX_SITE_URL cannot be used because WebAuthn RP ID must match the frontend domain.",
      );
    }

    const siteHostname = siteUrl ? new URL(siteUrl).hostname : undefined;
    const defaultOrigin = configuredSiteUrls?.allowedUrls ?? siteUrl;
    return {
      rpName: provider.options.rpName ?? siteHostname ?? "localhost",
      rpId: provider.options.rpId ?? siteHostname ?? "localhost",
      origin: provider.options.origin ?? defaultOrigin ?? "http://localhost",
      attestation: provider.options.attestation ?? "none",
      userVerification: provider.options.userVerification ?? "required",
      residentKey: provider.options.residentKey ?? "preferred",
      authenticatorAttachment: provider.options.authenticatorAttachment,
      algorithms: provider.options.algorithms ?? [coseAlgorithmES256, coseAlgorithmRS256],
      challengeExpirationMs: provider.options.challengeExpirationMs ?? 300_000,
    };
  } catch (error) {
    throw asConvexError(
      error,
      "PASSKEY_MISSING_CONFIG",
      "Passkey relying party configuration is invalid.",
    );
  }
}

function verifyClientDataType<T extends { type: ClientDataType }>(
  clientData: T,
  expectedType: ClientDataType,
  label: string,
): T {
  if (clientData.type !== expectedType) {
    throw convexError("PASSKEY_INVALID_CLIENT_DATA", `Invalid client data type: expected ${label}`);
  }
  return clientData;
}

function verifyOrigin<T extends { origin: string }>(clientData: T, rp: RpOptions): T {
  const allowed = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
  if (!allowed.includes(clientData.origin)) {
    throw convexError(
      "PASSKEY_INVALID_ORIGIN",
      `Invalid origin: ${clientData.origin}, expected one of: ${allowed.join(", ")}`,
    );
  }
  return clientData;
}

async function verifyAndConsumeChallenge<T extends { challenge: Uint8Array }>(
  clientData: T,
  ctx: EnrichedActionCtx,
  verifierValue: string,
): Promise<T> {
  const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(clientData.challenge)));
  let doc;
  try {
    doc = await queryVerifierById(ctx, verifierValue);
  } catch {
    throw convexError("PASSKEY_INVALID_CHALLENGE", "Invalid or expired passkey challenge.");
  }
  if (!doc || doc.signature !== challengeHash) {
    throw convexError("PASSKEY_INVALID_CHALLENGE", "Invalid or expired passkey challenge.");
  }
  try {
    await mutateVerifierDelete(ctx, verifierValue);
  } catch {
    throw convexError("PASSKEY_INVALID_CHALLENGE", "Invalid or expired passkey challenge.");
  }
  return clientData;
}

function verifyRpId<T extends { verifyRelyingPartyIdHash: (id: string) => boolean }>(
  authData: T,
  rpId: string,
): T {
  if (!authData.verifyRelyingPartyIdHash(rpId)) {
    throw convexError("PASSKEY_RP_MISMATCH", "Relying party ID mismatch.");
  }
  return authData;
}

function verifyUserFlags<T extends { userPresent: boolean; userVerified: boolean }>(
  authData: T,
  rp: RpOptions,
): T {
  if (!authData.userPresent) {
    throw convexError("PASSKEY_USER_PRESENCE", "User presence flag not set.");
  }
  if (rp.userVerification === "required" && !authData.userVerified) {
    throw convexError("PASSKEY_USER_VERIFICATION", "User verification required but not performed.");
  }
  return authData;
}

function resolvePasskeyDispatch(params: Record<string, unknown>): PasskeyDispatch {
  const flow = params.flow;
  if (typeof flow === "string" && PASSKEY_FLOWS.includes(flow as never)) {
    return { flow: flow as (typeof PASSKEY_FLOWS)[number] };
  }
  throw convexError(
    "PASSKEY_MISSING_FLOW",
    "Missing `flow` parameter. Expected one of: registerOptions, registerVerify, authOptions, authVerify",
  );
}

function requirePasskeyVerifier(verifier: string | undefined): string {
  if (verifier != null) {
    return verifier;
  }
  throw convexError("PASSKEY_MISSING_VERIFIER", "Missing verifier for passkey operation.");
}

async function requireAuthenticatedUserId(ctx: EnrichedActionCtx): Promise<string> {
  try {
    const userId = await getAuthenticatedUserIdOrNull(ctx);
    if (userId === null) {
      throw convexError(
        "PASSKEY_AUTH_REQUIRED",
        "Sign in first, then add a passkey to your account.",
      );
    }
    return userId;
  } catch {
    throw convexError(
      "PASSKEY_AUTH_REQUIRED",
      "Sign in first, then add a passkey to your account.",
    );
  }
}

function resolveRegistrationPublicKeyBytes(
  publicKey: NonNullable<
    ReturnType<typeof parseAttestationObject>["authenticatorData"]["credential"]
  >["publicKey"],
  algorithm: number,
): Uint8Array {
  if (algorithm === coseAlgorithmES256) {
    const ec2 = publicKey.ec2();
    const xBytes = new Uint8Array(32);
    let vx = ec2.x;
    for (let i = 31; i >= 0; i--) {
      xBytes[i] = Number(vx & 0xffn);
      vx >>= 8n;
    }
    const yBytes = new Uint8Array(32);
    let vy = ec2.y;
    for (let i = 31; i >= 0; i--) {
      yBytes[i] = Number(vy & 0xffn);
      vy >>= 8n;
    }
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    bytes.set(xBytes, 1);
    bytes.set(yBytes, 33);
    return bytes;
  }
  if (algorithm === coseAlgorithmRS256) {
    const rsa = publicKey.rsa();
    const rsaPubKey = new RSAPublicKey(rsa.n, rsa.e);
    return rsaPubKey.encodePKCS1();
  }
  throw convexError("PASSKEY_UNSUPPORTED_ALGORITHM", `Unsupported algorithm: ${algorithm}`);
}

function verifyAssertionSignature(
  passkey: Awaited<ReturnType<typeof queryPasskeyByCredentialId>> extends infer T
    ? Exclude<T, null>
    : never,
  signature: Uint8Array,
  messageHash: Uint8Array,
): void {
  if (passkey.algorithm === coseAlgorithmES256) {
    const ecPublicKey = decodeSEC1PublicKey(p256, new Uint8Array(passkey.publicKey));
    const ecdsaSignature = decodePKIXECDSASignature(signature);
    if (!verifyECDSASignature(ecPublicKey, messageHash, ecdsaSignature)) {
      throw convexError("PASSKEY_INVALID_SIGNATURE", "Invalid passkey signature.");
    }
    return;
  }
  if (passkey.algorithm === coseAlgorithmRS256) {
    const rsaPublicKey = decodePKCS1RSAPublicKey(new Uint8Array(passkey.publicKey));
    if (
      !verifyRSASSAPKCS1v15Signature(rsaPublicKey, sha256ObjectIdentifier, messageHash, signature)
    ) {
      throw convexError("PASSKEY_INVALID_SIGNATURE", "Invalid passkey signature.");
    }
    return;
  }
  throw convexError("PASSKEY_UNSUPPORTED_ALGORITHM", `Unsupported algorithm: ${passkey.algorithm}`);
}

export async function handlePasskeyFx(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  args: {
    params?: Record<string, unknown>;
    verifier?: string;
  },
): Promise<PasskeyResult> {
  const params = (args.params ?? {}) as PasskeyParams;
  const dispatch = resolvePasskeyDispatch(params);

  const flowHandlers: Record<string, () => Promise<PasskeyResult>> = {
    registerOptions: async () => {
      const userId = await requireAuthenticatedUserId(ctx);
      const rp = resolveRpOptions(provider);

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let verifier: string;
      try {
        verifier = await callVerifier(ctx, challengeHash);
      } catch {
        throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
      }

      let user;
      try {
        user = await queryUserById(ctx, userId);
      } catch {
        throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
      }
      const userName = params.userName ?? user?.email ?? "user";
      const userDisplayName = params.userDisplayName ?? user?.name ?? userName;

      let existing;
      try {
        existing = await queryPasskeysByUserId(ctx, userId);
      } catch {
        throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
      }
      const excludeCredentials = existing.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports,
      }));

      const userHandle = encodeBase64urlNoPadding(new TextEncoder().encode(userId));

      return {
        kind: "passkeyOptions" as const,
        options: {
          rp: { name: rp.rpName, id: rp.rpId },
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
              ? {
                  authenticatorAttachment: rp.authenticatorAttachment,
                }
              : {}),
          },
          excludeCredentials,
        },
        verifier,
      };
    },

    registerVerify: async () => {
      const userId = await requireAuthenticatedUserId(ctx);
      const rp = resolveRpOptions(provider);
      const verifier = requirePasskeyVerifier(args.verifier);

      const clientDataJSON = decodeBase64urlIgnorePadding(
        requireStringParam(params.clientDataJSON, "clientDataJSON"),
      );
      const clientData = parseClientDataJSON(clientDataJSON);
      verifyClientDataType(clientData, ClientDataType.Create, "webauthn.create");
      verifyOrigin(clientData, rp);
      await verifyAndConsumeChallenge(clientData, ctx, verifier);

      const attestationObjectBytes = decodeBase64urlIgnorePadding(
        requireStringParam(params.attestationObject, "attestationObject"),
      );
      const attestation = parseAttestationObject(attestationObjectBytes);
      const authData = attestation.authenticatorData;
      verifyRpId(authData, rp.rpId);
      verifyUserFlags(authData, rp);

      if (authData.credential == null) {
        throw convexError("PASSKEY_NO_CREDENTIAL", "No credential in attestation.");
      }

      const credential = authData.credential;
      const credentialId = encodeBase64urlNoPadding(credential.id);
      const publicKey = credential.publicKey;
      const algorithm = publicKey.isAlgorithmDefined()
        ? publicKey.algorithm()
        : publicKey.type() === COSEKeyType.EC2
          ? coseAlgorithmES256
          : publicKey.type() === COSEKeyType.RSA
            ? coseAlgorithmRS256
            : coseAlgorithmES256;
      const publicKeyBytes = resolveRegistrationPublicKeyBytes(publicKey, algorithm);

      try {
        const deviceType = params.deviceType ?? "single-device";
        const backedUp = params.backedUp ?? false;
        const db = authDb(ctx, ctx.auth.config);

        await db.accounts.create({
          userId,
          provider: provider.id,
          providerAccountId: credentialId,
        });

        await mutatePasskeyInsert(ctx, {
          userId,
          credentialId,
          publicKey: publicKeyBytes.buffer.slice(
            publicKeyBytes.byteOffset,
            publicKeyBytes.byteOffset + publicKeyBytes.byteLength,
          ),
          algorithm,
          counter: authData.signatureCounter,
          transports: params.transports,
          deviceType,
          backedUp,
          name: params.passkeyName,
          createdAt: Date.now(),
        });
      } catch {
        throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
      }

      let signInResult;
      try {
        signInResult = await callSignIn(ctx, {
          userId,
          generateTokens: true,
        });
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", "Failed to finalize passkey registration.");
      }
      return { kind: "signedIn" as const, session: signInResult };
    },

    authOptions: async () => {
      const rp = resolveRpOptions(provider);

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      const challengeHash = encodeBase64urlNoPadding(new Uint8Array(sha256(challenge)));

      let verifier: string;
      try {
        verifier = await callVerifier(ctx, challengeHash);
      } catch {
        throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
      }

      let allowCredentials:
        | Array<{ type: "public-key"; id: string; transports?: string[] }>
        | undefined;

      if (params.email) {
        const email = requireStringParam(params.email, "email");
        let user;
        try {
          user = await queryUserByVerifiedEmail(ctx, email);
        } catch {
          throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
        }
        if (user) {
          let passkeys;
          try {
            passkeys = await queryPasskeysByUserId(ctx, user._id);
          } catch {
            throw convexError("INTERNAL_ERROR", "An unexpected error occurred.");
          }
          if (passkeys.length > 0) {
            allowCredentials = passkeys.map((pk) => ({
              type: "public-key" as const,
              id: pk.credentialId,
              transports: pk.transports,
            }));
          }
        }
      }

      const options: {
        challenge: string;
        timeout: number;
        rpId: string;
        userVerification: string;
        allowCredentials?: Array<{
          type: "public-key";
          id: string;
          transports?: string[];
        }>;
      } = {
        challenge: encodeBase64urlNoPadding(challenge),
        timeout: rp.challengeExpirationMs,
        rpId: rp.rpId,
        userVerification: rp.userVerification,
      };

      if (allowCredentials) {
        options.allowCredentials = allowCredentials;
      }

      return {
        kind: "passkeyOptions" as const,
        options,
        verifier,
      };
    },

    authVerify: async () => {
      const rp = resolveRpOptions(provider);
      const verifier = requirePasskeyVerifier(args.verifier);

      const clientDataJSON = decodeBase64urlIgnorePadding(
        requireStringParam(params.clientDataJSON, "clientDataJSON"),
      );
      const clientData = parseClientDataJSON(clientDataJSON);
      verifyClientDataType(clientData, ClientDataType.Get, "webauthn.get");
      verifyOrigin(clientData, rp);
      await verifyAndConsumeChallenge(clientData, ctx, verifier);

      const credentialId = params.credentialId;
      if (credentialId == null) {
        throw convexError("PASSKEY_UNKNOWN_CREDENTIAL", "Missing credential ID");
      }

      let passkey;
      try {
        passkey = await queryPasskeyByCredentialId(ctx, credentialId);
      } catch {
        throw convexError("PASSKEY_UNKNOWN_CREDENTIAL", "Unknown passkey credential.");
      }
      if (passkey === null) {
        throw convexError("PASSKEY_UNKNOWN_CREDENTIAL", "Unknown credential");
      }

      const authenticatorDataBytes = decodeBase64urlIgnorePadding(
        requireStringParam(params.authenticatorData, "authenticatorData"),
      );
      const authenticatorData = parseAuthenticatorData(authenticatorDataBytes);
      const signatureBytes = decodeBase64urlIgnorePadding(
        requireStringParam(params.signature, "signature"),
      );
      const signatureMessage = createAssertionSignatureMessage(
        authenticatorDataBytes,
        clientDataJSON,
      );
      const messageHash = sha256(signatureMessage);

      verifyRpId(authenticatorData, rp.rpId);
      verifyUserFlags(authenticatorData, rp);
      verifyAssertionSignature(passkey, signatureBytes, messageHash);

      if (
        passkey.counter !== 0 &&
        authenticatorData.signatureCounter !== 0 &&
        authenticatorData.signatureCounter <= passkey.counter
      ) {
        throw convexError(
          "PASSKEY_COUNTER_ERROR",
          "Authenticator counter did not increase — possible credential cloning detected.",
        );
      }

      try {
        await mutatePasskeyUpdateCounter(
          ctx,
          passkey._id,
          authenticatorData.signatureCounter,
          Date.now(),
        );
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", "Failed to update passkey counter.");
      }

      let signInResult;
      try {
        signInResult = await callSignIn(ctx, {
          userId: passkey.userId,
          generateTokens: true,
        });
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", "Failed to finalize passkey sign-in.");
      }

      return { kind: "signedIn" as const, session: signInResult };
    },
  };

  const handler = flowHandlers[dispatch.flow];
  if (!handler) {
    throw convexError("PASSKEY_MISSING_FLOW", `Unknown passkey flow: ${dispatch.flow}`);
  }
  return handler();
}
