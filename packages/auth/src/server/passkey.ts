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
import {
  decodeBase64urlIgnorePadding,
  encodeBase64urlNoPadding,
} from "@oslojs/encoding";
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
import { ConvexError } from "convex/values";
import { Effect, Match } from "effect";

import { authFlowError } from "../shared/errors";
import { authDb } from "./db";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { userIdFromIdentitySubject } from "./identity";
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
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | {
      kind: "passkeyOptions";
      options: Record<string, unknown>;
      verifier: string;
    };

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

const convexError = (code: string, message: string) =>
  toConvexError(authFlowError(code, message));

const asConvexError = (
  error: unknown,
  code: string,
  message: string,
): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? error
    : error instanceof Error
      ? toConvexError(authFlowError(code, error.message || message))
      : convexError(code, message);

const resolveRpOptionsFx = (
  provider: PasskeyProviderConfig,
): Effect.Effect<RpOptions, ConvexError<AuthErrorData>> =>
  Effect.sync(() => {
    const configuredSiteUrls =
      process.env.SITE_URL === undefined ? null : siteUrlsFromEnv();
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
      algorithms: provider.options.algorithms ?? [
        coseAlgorithmES256,
        coseAlgorithmRS256,
      ],
      challengeExpirationMs: provider.options.challengeExpirationMs ?? 300_000,
    };
  }).pipe(
    Effect.catch((error) =>
      Effect.fail(
        asConvexError(
          error,
          "PASSKEY_MISSING_CONFIG",
          "Passkey relying party configuration is invalid.",
        ),
      ),
    ),
  );

const verifyClientDataType =
  <T extends { type: ClientDataType }>(
    expectedType: ClientDataType,
    label: string,
  ) =>
  (clientData: T): Effect.Effect<T, ConvexError<AuthErrorData>> =>
    clientData.type === expectedType
      ? Effect.succeed(clientData)
      : Effect.fail(
          convexError(
            "PASSKEY_INVALID_CLIENT_DATA",
            `Invalid client data type: expected ${label}`,
          ),
        );

const verifyOrigin =
  (rp: RpOptions) =>
  <T extends { origin: string }>(
    clientData: T,
  ): Effect.Effect<T, ConvexError<AuthErrorData>> => {
    const allowed = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
    return allowed.includes(clientData.origin)
      ? Effect.succeed(clientData)
      : Effect.fail(
          convexError(
            "PASSKEY_INVALID_ORIGIN",
            `Invalid origin: ${clientData.origin}, expected one of: ${allowed.join(", ")}`,
          ),
        );
  };

const verifyAndConsumeChallenge =
  (ctx: EnrichedActionCtx, verifierValue: string) =>
  <T extends { challenge: Uint8Array }>(
    clientData: T,
  ): Effect.Effect<T, ConvexError<AuthErrorData>> => {
    const challengeHash = encodeBase64urlNoPadding(
      new Uint8Array(sha256(clientData.challenge)),
    );
    return Effect.gen(function* () {
      const doc = yield* Effect.tryPromise({
        try: () => queryVerifierById(ctx, verifierValue),
        catch: () =>
          convexError(
            "PASSKEY_INVALID_CHALLENGE",
            "Invalid or expired passkey challenge.",
          ),
      });
      if (!doc || doc.signature !== challengeHash) {
        return yield* Effect.fail(
          convexError(
            "PASSKEY_INVALID_CHALLENGE",
            "Invalid or expired passkey challenge.",
          ),
        );
      }
      yield* Effect.tryPromise({
        try: () => mutateVerifierDelete(ctx, verifierValue),
        catch: () =>
          convexError(
            "PASSKEY_INVALID_CHALLENGE",
            "Invalid or expired passkey challenge.",
          ),
      });
      return clientData;
    });
  };

const verifyRpId =
  (rpId: string) =>
  <T extends { verifyRelyingPartyIdHash: (id: string) => boolean }>(
    authData: T,
  ): Effect.Effect<T, ConvexError<AuthErrorData>> =>
    authData.verifyRelyingPartyIdHash(rpId)
      ? Effect.succeed(authData)
      : Effect.fail(
          convexError("PASSKEY_RP_MISMATCH", "Relying party ID mismatch."),
        );

const verifyUserFlags =
  (rp: RpOptions) =>
  <T extends { userPresent: boolean; userVerified: boolean }>(
    authData: T,
  ): Effect.Effect<T, ConvexError<AuthErrorData>> =>
    !authData.userPresent
      ? Effect.fail(
          convexError("PASSKEY_USER_PRESENCE", "User presence flag not set."),
        )
      : rp.userVerification === "required" && !authData.userVerified
        ? Effect.fail(
            convexError(
              "PASSKEY_USER_VERIFICATION",
              "User verification required but not performed.",
            ),
          )
        : Effect.succeed(authData);

const resolvePasskeyDispatchFx = (
  params: Record<string, unknown>,
): Effect.Effect<PasskeyDispatch, ConvexError<AuthErrorData>> => {
  const flow = params.flow;
  return typeof flow === "string" && PASSKEY_FLOWS.includes(flow as never)
    ? Effect.succeed({ flow: flow as (typeof PASSKEY_FLOWS)[number] })
    : Effect.fail(
        convexError(
          "PASSKEY_MISSING_FLOW",
          "Missing `flow` parameter. Expected one of: registerOptions, registerVerify, authOptions, authVerify",
        ),
      );
};

const requirePasskeyVerifierFx = (
  verifier: string | undefined,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  verifier != null
    ? Effect.succeed(verifier)
    : Effect.fail(
        convexError(
          "PASSKEY_MISSING_VERIFIER",
          "Missing verifier for passkey operation.",
        ),
      );

const requireAuthenticatedUserId = (
  ctx: EnrichedActionCtx,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => ctx.auth.getUserIdentity(),
      catch: () =>
        convexError(
          "PASSKEY_AUTH_REQUIRED",
          "Sign in first, then add a passkey to your account.",
        ),
    }),
    (identity) =>
      Match.value(identity).pipe(
        Match.when(null, () =>
          Effect.fail(
            convexError(
              "PASSKEY_AUTH_REQUIRED",
              "Sign in first, then add a passkey to your account.",
            ),
          ),
        ),
        Match.orElse((identity) =>
          Effect.succeed(userIdFromIdentitySubject(identity.subject)),
        ),
      ),
  );

const resolveRegistrationPublicKeyBytes = (
  publicKey: NonNullable<
    ReturnType<typeof parseAttestationObject>["authenticatorData"]["credential"]
  >["publicKey"],
  algorithm: number,
): Effect.Effect<Uint8Array, ConvexError<AuthErrorData>> =>
  Match.value(algorithm).pipe(
    Match.when(coseAlgorithmES256, () => {
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
      return Effect.succeed(bytes);
    }),
    Match.when(coseAlgorithmRS256, () => {
      const rsa = publicKey.rsa();
      const rsaPubKey = new RSAPublicKey(rsa.n, rsa.e);
      return Effect.succeed(rsaPubKey.encodePKCS1());
    }),
    Match.orElse((algorithm) =>
      Effect.fail(
        convexError(
          "PASSKEY_UNSUPPORTED_ALGORITHM",
          `Unsupported algorithm: ${algorithm}`,
        ),
      ),
    ),
  );

const verifyAssertionSignature = (
  passkey: Awaited<
    ReturnType<typeof queryPasskeyByCredentialId>
  > extends infer T
    ? Exclude<T, null>
    : never,
  signature: Uint8Array,
  messageHash: Uint8Array,
): Effect.Effect<void, ConvexError<AuthErrorData>> =>
  Match.value(passkey.algorithm).pipe(
    Match.when(coseAlgorithmES256, () => {
      const ecPublicKey = decodeSEC1PublicKey(
        p256,
        new Uint8Array(passkey.publicKey),
      );
      const ecdsaSignature = decodePKIXECDSASignature(signature);
      return verifyECDSASignature(ecPublicKey, messageHash, ecdsaSignature)
        ? Effect.void
        : Effect.fail(
            convexError(
              "PASSKEY_INVALID_SIGNATURE",
              "Invalid passkey signature.",
            ),
          );
    }),
    Match.when(coseAlgorithmRS256, () => {
      const rsaPublicKey = decodePKCS1RSAPublicKey(
        new Uint8Array(passkey.publicKey),
      );
      return verifyRSASSAPKCS1v15Signature(
        rsaPublicKey,
        sha256ObjectIdentifier,
        messageHash,
        signature,
      )
        ? Effect.void
        : Effect.fail(
            convexError(
              "PASSKEY_INVALID_SIGNATURE",
              "Invalid passkey signature.",
            ),
          );
    }),
    Match.orElse((algorithm) =>
      Effect.fail(
        convexError(
          "PASSKEY_UNSUPPORTED_ALGORITHM",
          `Unsupported algorithm: ${algorithm}`,
        ),
      ),
    ),
  );

export function handlePasskeyFx(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  args: {
    params?: Record<string, unknown>;
    verifier?: string;
  },
): Effect.Effect<PasskeyResult, ConvexError<AuthErrorData>> {
  const params = (args.params ?? {}) as PasskeyParams;

  return Effect.flatMap(resolvePasskeyDispatchFx(params), (dispatch) =>
    Match.value(dispatch).pipe(
      Match.when({ flow: "registerOptions" }, () =>
        Effect.gen(function* () {
          const userId = yield* requireAuthenticatedUserId(ctx);
          const rp = yield* resolveRpOptionsFx(provider);

          const challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
          const challengeHash = encodeBase64urlNoPadding(
            new Uint8Array(sha256(challenge)),
          );

          const verifier = yield* Effect.tryPromise({
            try: () => callVerifier(ctx, challengeHash),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });

          const user = yield* Effect.tryPromise({
            try: () => queryUserById(ctx, userId),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });
          const userName = params.userName ?? user?.email ?? "user";
          const userDisplayName =
            params.userDisplayName ?? user?.name ?? userName;

          const existing = yield* Effect.tryPromise({
            try: () => queryPasskeysByUserId(ctx, userId),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });
          const excludeCredentials = existing.map((pk) => ({
            id: pk.credentialId,
            transports: pk.transports,
          }));

          const userHandle = encodeBase64urlNoPadding(
            new TextEncoder().encode(userId),
          );

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
        }),
      ),
      Match.when({ flow: "registerVerify" }, () =>
        Effect.gen(function* () {
          const userId = yield* requireAuthenticatedUserId(ctx);
          const rp = yield* resolveRpOptionsFx(provider);
          const verifier = yield* requirePasskeyVerifierFx(args.verifier);

          const clientDataJSON = decodeBase64urlIgnorePadding(
            requireStringParam(params.clientDataJSON, "clientDataJSON"),
          );
          const clientData = parseClientDataJSON(clientDataJSON);
          yield* verifyClientDataType(
            ClientDataType.Create,
            "webauthn.create",
          )(clientData);
          yield* verifyOrigin(rp)(clientData);
          yield* verifyAndConsumeChallenge(ctx, verifier)(clientData);

          const attestationObjectBytes = decodeBase64urlIgnorePadding(
            requireStringParam(params.attestationObject, "attestationObject"),
          );
          const attestation = parseAttestationObject(attestationObjectBytes);
          const authData = attestation.authenticatorData;
          yield* verifyRpId(rp.rpId)(authData);
          yield* verifyUserFlags(rp)(authData);

          if (authData.credential == null) {
            return yield* Effect.fail(
              convexError(
                "PASSKEY_NO_CREDENTIAL",
                "No credential in attestation.",
              ),
            );
          }

          const credential = authData.credential;
          const credentialId = encodeBase64urlNoPadding(credential.id);
          const publicKey = credential.publicKey;
          const algorithm = publicKey.isAlgorithmDefined()
            ? publicKey.algorithm()
            : Match.value(publicKey.type()).pipe(
                Match.when(COSEKeyType.EC2, () => coseAlgorithmES256),
                Match.when(COSEKeyType.RSA, () => coseAlgorithmRS256),
                Match.orElse(() => coseAlgorithmES256),
              );
          const publicKeyBytes = yield* resolveRegistrationPublicKeyBytes(
            publicKey,
            algorithm,
          );

          yield* Effect.tryPromise({
            try: async () => {
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
            },
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });

          const signInResult = yield* Effect.tryPromise({
            try: () =>
              callSignIn(ctx, {
                userId,
                generateTokens: true,
              }),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });
          return { kind: "signedIn" as const, signedIn: signInResult };
        }),
      ),
      Match.when({ flow: "authOptions" }, () =>
        Effect.gen(function* () {
          const rp = yield* resolveRpOptionsFx(provider);

          const challenge = new Uint8Array(32);
          crypto.getRandomValues(challenge);
          const challengeHash = encodeBase64urlNoPadding(
            new Uint8Array(sha256(challenge)),
          );

          const verifier = yield* Effect.tryPromise({
            try: () => callVerifier(ctx, challengeHash),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });

          let allowCredentials:
            | Array<{ type: "public-key"; id: string; transports?: string[] }>
            | undefined;

          if (params.email) {
            const email = requireStringParam(params.email, "email");
            const user = yield* Effect.tryPromise({
              try: () => queryUserByVerifiedEmail(ctx, email),
              catch: () =>
                convexError("INTERNAL_ERROR", "An unexpected error occurred."),
            });
            if (user) {
              const passkeys = yield* Effect.tryPromise({
                try: () => queryPasskeysByUserId(ctx, user._id),
                catch: () =>
                  convexError(
                    "INTERNAL_ERROR",
                    "An unexpected error occurred.",
                  ),
              });
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
        }),
      ),
      Match.when({ flow: "authVerify" }, () =>
        Effect.gen(function* () {
          const rp = yield* resolveRpOptionsFx(provider);
          const verifier = yield* requirePasskeyVerifierFx(args.verifier);

          const clientDataJSON = decodeBase64urlIgnorePadding(
            requireStringParam(params.clientDataJSON, "clientDataJSON"),
          );
          const clientData = parseClientDataJSON(clientDataJSON);
          yield* verifyClientDataType(
            ClientDataType.Get,
            "webauthn.get",
          )(clientData);
          yield* verifyOrigin(rp)(clientData);
          yield* verifyAndConsumeChallenge(ctx, verifier)(clientData);

          const credentialId = params.credentialId;
          if (credentialId == null) {
            return yield* Effect.fail(
              convexError(
                "PASSKEY_UNKNOWN_CREDENTIAL",
                "Missing credential ID",
              ),
            );
          }

          const passkey = yield* Effect.flatMap(
            Effect.tryPromise({
              try: () => queryPasskeyByCredentialId(ctx, credentialId),
              catch: () =>
                convexError(
                  "PASSKEY_UNKNOWN_CREDENTIAL",
                  "Unknown passkey credential.",
                ),
            }),
            (passkey) =>
              Match.value(passkey).pipe(
                Match.when(null, () =>
                  Effect.fail(
                    convexError(
                      "PASSKEY_UNKNOWN_CREDENTIAL",
                      "Unknown credential",
                    ),
                  ),
                ),
                Match.orElse((passkey) => Effect.succeed(passkey)),
              ),
          );

          const authenticatorDataBytes = decodeBase64urlIgnorePadding(
            requireStringParam(params.authenticatorData, "authenticatorData"),
          );
          const authenticatorData = parseAuthenticatorData(
            authenticatorDataBytes,
          );
          const signature = decodeBase64urlIgnorePadding(
            requireStringParam(params.signature, "signature"),
          );
          const signatureMessage = createAssertionSignatureMessage(
            authenticatorDataBytes,
            clientDataJSON,
          );
          const messageHash = sha256(signatureMessage);

          yield* verifyRpId(rp.rpId)(authenticatorData);
          yield* verifyUserFlags(rp)(authenticatorData);
          yield* verifyAssertionSignature(passkey, signature, messageHash);

          if (
            passkey.counter !== 0 &&
            authenticatorData.signatureCounter !== 0 &&
            authenticatorData.signatureCounter <= passkey.counter
          ) {
            return yield* Effect.fail(
              convexError(
                "PASSKEY_COUNTER_ERROR",
                "Authenticator counter did not increase — possible credential cloning detected.",
              ),
            );
          }

          yield* Effect.tryPromise({
            try: () =>
              mutatePasskeyUpdateCounter(
                ctx,
                passkey._id,
                authenticatorData.signatureCounter,
                Date.now(),
              ),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });

          const signInResult = yield* Effect.tryPromise({
            try: () =>
              callSignIn(ctx, {
                userId: passkey.userId,
                generateTokens: true,
              }),
            catch: () =>
              convexError("INTERNAL_ERROR", "An unexpected error occurred."),
          });

          return { kind: "signedIn" as const, signedIn: signInResult };
        }),
      ),
      Match.exhaustive,
    ),
  );
}
