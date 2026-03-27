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
 * All functions return `Fx<A, ConvexError<any>>` composed via `Fx.chain` pipelines.
 *
 * @module
 */

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
  parseAttestationObject,
  parseClientDataJSON,
  parseAuthenticatorData,
  createAssertionSignatureMessage,
  ClientDataType,
  coseAlgorithmES256,
  coseAlgorithmRS256,
  COSEKeyType,
} from "@oslojs/webauthn";
import type { Fx as FxType } from "@robelest/fx";
import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { ConvexError } from "convex/values";

import { authDb } from "./db";
import { userIdFromIdentitySubject } from "./identity";
import { callSignIn, callVerifier } from "./mutations/index";
import { callVerifierSignature } from "./mutations/signature";
import { PasskeyProviderConfig, GenericActionCtxWithAuthConfig } from "./types";
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

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

// ============================================================================
// Resolve RP options — Fx pipeline with validation
// ============================================================================

/** Resolved relying party configuration. */
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

/**
 * Resolve passkey relying party options from provider config and environment.
 *
 * Returns `Fx<RpOptions, ConvexError<any>>` — fails if neither SITE_URL nor rpId
 * is configured.
 */
const resolveRpOptionsFx = (
  provider: PasskeyProviderConfig,
): FxType<RpOptions, ConvexError<any>> => {
  const siteUrl = process.env.SITE_URL;
  const hasSiteUrl = siteUrl !== undefined && siteUrl !== "";
  const hasRpId = provider.options.rpId !== undefined;

  return Fx.succeed({ siteUrl, hasSiteUrl, hasRpId }).pipe(
    Fx.chain(({ siteUrl, hasSiteUrl, hasRpId }) =>
      !hasSiteUrl && !hasRpId
        ? Cv.fail({
            code: "PASSKEY_MISSING_CONFIG",
            message:
              "Passkey provider requires SITE_URL env var (your frontend URL) " +
              "or explicit rpId / origin in the provider config. " +
              "CONVEX_SITE_URL cannot be used because WebAuthn RP ID must match the frontend domain.",
          })
        : Fx.succeed(siteUrl),
    ),
    Fx.map((siteUrl) => {
      const siteHostname = siteUrl ? new URL(siteUrl).hostname : undefined;
      return {
        rpName: provider.options.rpName ?? siteHostname ?? "localhost",
        rpId: provider.options.rpId ?? siteHostname ?? "localhost",
        origin: provider.options.origin ?? siteUrl ?? "http://localhost",
        attestation: provider.options.attestation ?? "none",
        userVerification: provider.options.userVerification ?? "required",
        residentKey: provider.options.residentKey ?? "preferred",
        authenticatorAttachment: provider.options.authenticatorAttachment,
        algorithms: provider.options.algorithms ?? [
          coseAlgorithmES256,
          coseAlgorithmRS256,
        ],
        challengeExpirationMs:
          provider.options.challengeExpirationMs ?? 300_000,
      };
    }),
  );
};

// ============================================================================
// Composable validators — small functions (A) => Fx<B, ConvexError<any>>
// ============================================================================

/** Verify client data type matches expected WebAuthn ceremony type. */
const verifyClientDataType =
  <T extends { type: ClientDataType }>(
    expectedType: ClientDataType,
    label: string,
  ) =>
  (clientData: T): FxType<T, ConvexError<any>> =>
    clientData.type === expectedType
      ? Fx.succeed(clientData)
      : Cv.fail({
          code: "PASSKEY_INVALID_CLIENT_DATA",
          message: `Invalid client data type: expected ${label}`,
        });

/** Verify origin is in the allowed list. */
const verifyOrigin =
  (rp: RpOptions) =>
  <T extends { origin: string }>(
    clientData: T,
  ): FxType<T, ConvexError<any>> => {
    const allowed = Array.isArray(rp.origin) ? rp.origin : [rp.origin];
    return allowed.includes(clientData.origin)
      ? Fx.succeed(clientData)
      : Cv.fail({
          code: "PASSKEY_INVALID_ORIGIN",
          message: `Invalid origin: ${clientData.origin}, expected one of: ${allowed.join(", ")}`,
        });
  };

/** Verify the challenge hash matches the stored verifier, then delete verifier. */
const verifyAndConsumeChallenge =
  (ctx: EnrichedActionCtx, verifierValue: string) =>
  <T extends { challenge: Uint8Array }>(
    clientData: T,
  ): FxType<T, ConvexError<any>> => {
    const challengeHash = encodeBase64urlNoPadding(
      new Uint8Array(sha256(clientData.challenge)),
    );
    return Fx.from({
      ok: () => queryVerifierById(ctx, verifierValue),
      err: () =>
        Cv.error({
          code: "PASSKEY_INVALID_CHALLENGE",
          message: "Invalid or expired passkey challenge.",
        }),
    }).pipe(
      Fx.chain((doc) =>
        !doc || doc.signature !== challengeHash
          ? Cv.fail({
              code: "PASSKEY_INVALID_CHALLENGE",
              message: "Invalid or expired passkey challenge.",
            })
          : Fx.succeed(doc),
      ),
      Fx.chain(() =>
        Fx.from({
          ok: () => mutateVerifierDelete(ctx, verifierValue),
          err: () =>
            Cv.error({
              code: "PASSKEY_INVALID_CHALLENGE",
              message: "Invalid or expired passkey challenge.",
            }),
        }),
      ),
      Fx.map(() => clientData),
    );
  };

/** Verify RP ID hash matches. */
const verifyRpId =
  (rpId: string) =>
  <T extends { verifyRelyingPartyIdHash: (id: string) => boolean }>(
    authData: T,
  ): FxType<T, ConvexError<any>> =>
    authData.verifyRelyingPartyIdHash(rpId)
      ? Fx.succeed(authData)
      : Cv.fail({
          code: "PASSKEY_RP_MISMATCH",
          message: "Relying party ID mismatch.",
        });

/** Verify user presence and (optionally) user verification flags. */
const verifyUserFlags =
  (rp: RpOptions) =>
  <T extends { userPresent: boolean; userVerified: boolean }>(
    authData: T,
  ): FxType<T, ConvexError<any>> =>
    !authData.userPresent
      ? Cv.fail({
          code: "PASSKEY_USER_PRESENCE",
          message: "User presence flag not set.",
        })
      : rp.userVerification === "required" && !authData.userVerified
        ? Cv.fail({
            code: "PASSKEY_USER_VERIFICATION",
            message: "User verification required but not performed.",
          })
        : Fx.succeed(authData);

// ============================================================================
// Registration flow
// ============================================================================

// ============================================================================
// Authentication flow
// ============================================================================

// ============================================================================
// Main dispatch
// ============================================================================

/** Result type for all passkey flows. */
type PasskeyResult =
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string };

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

const resolvePasskeyDispatchFx = (
  params: Record<string, unknown>,
): FxType<PasskeyDispatch, ConvexError<any>> => {
  const flow = params.flow;
  return typeof flow === "string" && PASSKEY_FLOWS.includes(flow as never)
    ? Fx.succeed({ flow: flow as (typeof PASSKEY_FLOWS)[number] })
    : Cv.fail({
        code: "PASSKEY_MISSING_FLOW",
        message:
          "Missing `flow` parameter. Expected one of: registerOptions, registerVerify, authOptions, authVerify",
      });
};

const requirePasskeyVerifierFx = (
  verifier: string | undefined,
): FxType<string, ConvexError<any>> =>
  verifier != null
    ? Fx.succeed(verifier)
    : Cv.fail({
        code: "PASSKEY_MISSING_VERIFIER",
        message: "Missing verifier for passkey operation.",
      });

/**
 * Main passkey handler dispatched from signIn.ts.
 *
 * Routes to the appropriate phase based on `params.flow` via `dispatchFx`.
 */
export function handlePasskeyFx(
  ctx: EnrichedActionCtx,
  provider: PasskeyProviderConfig,
  args: {
    params?: Record<string, any>;
    verifier?: string;
  },
): FxType<PasskeyResult, ConvexError<any>> {
  const params = (args.params ?? {}) as Record<string, any>;

  return resolvePasskeyDispatchFx(params).pipe(
    Fx.chain((dispatch) => {
      const flowFx: FxType<PasskeyResult, ConvexError<any>> = Fx.match(
        dispatch,
      ).on("flow", {
        registerOptions: (_) =>
          Fx.zip(
            Fx.from({
              ok: () => ctx.auth.getUserIdentity(),
              err: () =>
                Cv.error({
                  code: "PASSKEY_AUTH_REQUIRED",
                  message: "Sign in first, then add a passkey to your account.",
                }),
            }).pipe(
              Fx.chain((id) =>
                id === null
                  ? Cv.fail({
                      code: "PASSKEY_AUTH_REQUIRED",
                      message:
                        "Sign in first, then add a passkey to your account.",
                    })
                  : Fx.succeed(userIdFromIdentitySubject(id.subject)),
              ),
            ),
            resolveRpOptionsFx(provider),
          ).pipe(
            Fx.chain(([userId, rp]) => {
              const challenge = new Uint8Array(32);
              crypto.getRandomValues(challenge);
              const challengeHash = encodeBase64urlNoPadding(
                new Uint8Array(sha256(challenge)),
              );

              return Fx.from({
                ok: async () => {
                  const verifier = await callVerifier(ctx);
                  await callVerifierSignature(ctx, {
                    verifier,
                    signature: challengeHash,
                  });

                  const user = await queryUserById(ctx, userId);
                  const userName = params.userName ?? user?.email ?? "user";
                  const userDisplayName =
                    params.userDisplayName ?? user?.name ?? userName;

                  const existing = await queryPasskeysByUserId(ctx, userId);
                  const excludeCredentials = existing.map((pk) => ({
                    id: pk.credentialId,
                    transports: pk.transports,
                  }));

                  const userHandle = encodeBase64urlNoPadding(
                    new TextEncoder().encode(userId),
                  );

                  const options = {
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
                  };

                  return {
                    kind: "passkeyOptions" as const,
                    options,
                    verifier,
                  };
                },
                err: () =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: "An unexpected error occurred.",
                  }),
              });
            }),
          ),
        registerVerify: (_) =>
          Fx.zip(
            Fx.from({
              ok: () => ctx.auth.getUserIdentity(),
              err: () =>
                Cv.error({
                  code: "PASSKEY_AUTH_REQUIRED",
                  message: "Sign in first, then add a passkey to your account.",
                }),
            }).pipe(
              Fx.chain((id) =>
                id === null
                  ? Cv.fail({
                      code: "PASSKEY_AUTH_REQUIRED",
                      message:
                        "Sign in first, then add a passkey to your account.",
                    })
                  : Fx.succeed(userIdFromIdentitySubject(id.subject)),
              ),
            ),
            resolveRpOptionsFx(provider),
          ).pipe(
            Fx.chain(([userId, rp]) =>
              requirePasskeyVerifierFx(args.verifier).pipe(
                Fx.chain((verifier) => {
                  const clientDataJSON = decodeBase64urlIgnorePadding(
                    params.clientDataJSON,
                  );
                  const clientData = parseClientDataJSON(clientDataJSON);

                  const verifiedClientDataFx = Fx.succeed(clientData).pipe(
                    Fx.chain(
                      verifyClientDataType(
                        ClientDataType.Create,
                        "webauthn.create",
                      ),
                    ),
                    Fx.chain(verifyOrigin(rp)),
                    Fx.chain(verifyAndConsumeChallenge(ctx, verifier)),
                    Fx.map(() => {
                      const attestationObjectBytes =
                        decodeBase64urlIgnorePadding(params.attestationObject);
                      const attestation = parseAttestationObject(
                        attestationObjectBytes,
                      );
                      return attestation.authenticatorData;
                    }),
                  );

                  return verifiedClientDataFx.pipe(
                    Fx.chain(verifyRpId(rp.rpId)),
                    Fx.chain(verifyUserFlags(rp)),
                    Fx.chain((authData) => {
                      if (authData.credential == null) {
                        return Cv.fail({
                          code: "PASSKEY_NO_CREDENTIAL",
                          message: "No credential in attestation.",
                        });
                      }
                      return Fx.succeed({
                        authData,
                        credential: authData.credential,
                      });
                    }),
                    Fx.chain(({ authData, credential }) => {
                      const credentialId = encodeBase64urlNoPadding(
                        credential.id,
                      );
                      const publicKey = credential.publicKey;

                      let algorithm: number;
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

                      const handlers: Record<
                        number,
                        (() => FxType<Uint8Array, ConvexError<any>>) | undefined
                      > = {
                        [coseAlgorithmES256]: () => {
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
                          return Fx.succeed(bytes);
                        },
                        [coseAlgorithmRS256]: () => {
                          const rsa = publicKey.rsa();
                          const rsaPubKey = new RSAPublicKey(rsa.n, rsa.e);
                          return Fx.succeed(rsaPubKey.encodePKCS1());
                        },
                      };

                      const handler = handlers[algorithm];
                      return (
                        handler
                          ? handler()
                          : Cv.fail({
                              code: "PASSKEY_UNSUPPORTED_ALGORITHM",
                              message: `Unsupported algorithm: ${algorithm}`,
                            })
                      ).pipe(
                        Fx.chain((publicKeyBytes) =>
                          Fx.from({
                            ok: async () => {
                              const deviceType =
                                params.deviceType ?? "single-device";
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
                                  publicKeyBytes.byteOffset +
                                    publicKeyBytes.byteLength,
                                ),
                                algorithm,
                                counter: authData.signatureCounter,
                                transports: params.transports,
                                deviceType,
                                backedUp,
                                name: params.passkeyName,
                                createdAt: Date.now(),
                              });

                              const signInResult = await callSignIn(ctx, {
                                userId,
                                generateTokens: true,
                              });

                              return {
                                kind: "signedIn" as const,
                                signedIn: signInResult,
                              };
                            },
                            err: () =>
                              Cv.error({
                                code: "INTERNAL_ERROR",
                                message: "An unexpected error occurred.",
                              }),
                          }),
                        ),
                      );
                    }),
                  );
                }),
              ),
            ),
          ),
        authOptions: (_) =>
          resolveRpOptionsFx(provider).pipe(
            Fx.chain((rp) => {
              const challenge = new Uint8Array(32);
              crypto.getRandomValues(challenge);
              const challengeHash = encodeBase64urlNoPadding(
                new Uint8Array(sha256(challenge)),
              );

              return Fx.from({
                ok: async () => {
                  const verifier = await callVerifier(ctx);
                  await callVerifierSignature(ctx, {
                    verifier,
                    signature: challengeHash,
                  });

                  let allowCredentials:
                    | Array<{
                        type: string;
                        id: string;
                        transports?: string[];
                      }>
                    | undefined;
                  if (params.email) {
                    const user = await queryUserByVerifiedEmail(
                      ctx,
                      params.email,
                    );
                    if (user) {
                      const passkeys = await queryPasskeysByUserId(
                        ctx,
                        user._id,
                      );
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

                  return {
                    kind: "passkeyOptions" as const,
                    options,
                    verifier,
                  };
                },
                err: () =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: "An unexpected error occurred.",
                  }),
              });
            }),
          ),
        authVerify: (_) =>
          Fx.zip(
            resolveRpOptionsFx(provider),
            requirePasskeyVerifierFx(args.verifier),
          ).pipe(
            Fx.chain(([rp, verifier]) => {
              const clientDataJSON = decodeBase64urlIgnorePadding(
                params.clientDataJSON,
              );
              const clientData = parseClientDataJSON(clientDataJSON);

              const verifiedClientDataFx = Fx.succeed(clientData).pipe(
                Fx.chain(
                  verifyClientDataType(ClientDataType.Get, "webauthn.get"),
                ),
                Fx.chain(verifyOrigin(rp)),
                Fx.chain(verifyAndConsumeChallenge(ctx, verifier)),
                Fx.chain(() =>
                  params.credentialId != null
                    ? Fx.succeed(params.credentialId as string)
                    : Cv.fail({
                        code: "PASSKEY_UNKNOWN_CREDENTIAL",
                        message: "Missing credential ID",
                      }),
                ),
              );

              return verifiedClientDataFx.pipe(
                Fx.chain((credentialId) =>
                  Fx.from({
                    ok: () => queryPasskeyByCredentialId(ctx, credentialId),
                    err: () =>
                      Cv.error({
                        code: "PASSKEY_UNKNOWN_CREDENTIAL",
                        message: "Unknown passkey credential.",
                      }),
                  }).pipe(
                    Fx.chain((passkey) =>
                      passkey
                        ? Fx.succeed(passkey)
                        : Cv.fail({
                            code: "PASSKEY_UNKNOWN_CREDENTIAL",
                            message: "Unknown credential",
                          }),
                    ),
                  ),
                ),
                Fx.chain((passkey) => {
                  const authenticatorDataBytes = decodeBase64urlIgnorePadding(
                    params.authenticatorData,
                  );
                  const authenticatorData = parseAuthenticatorData(
                    authenticatorDataBytes,
                  );

                  const signature = decodeBase64urlIgnorePadding(
                    params.signature,
                  );
                  const signatureMessage = createAssertionSignatureMessage(
                    authenticatorDataBytes,
                    clientDataJSON,
                  );
                  const messageHash = sha256(signatureMessage);

                  const checkedAuthenticatorFx = Fx.succeed(
                    authenticatorData,
                  ).pipe(
                    Fx.chain(verifyRpId(rp.rpId)),
                    Fx.chain(verifyUserFlags(rp)),
                  );

                  const signatureVerifiedFx = checkedAuthenticatorFx.pipe(
                    Fx.chain(() => {
                      const storedPublicKeyBytes = new Uint8Array(
                        passkey.publicKey,
                      );
                      const algorithmHandlers: Record<
                        number,
                        (() => FxType<void, ConvexError<any>>) | undefined
                      > = {
                        [coseAlgorithmES256]: () => {
                          const ecPublicKey = decodeSEC1PublicKey(
                            p256,
                            storedPublicKeyBytes,
                          );
                          const ecdsaSignature =
                            decodePKIXECDSASignature(signature);
                          const valid = verifyECDSASignature(
                            ecPublicKey,
                            messageHash,
                            ecdsaSignature,
                          );
                          return valid
                            ? Fx.succeed(undefined as void)
                            : Cv.fail({
                                code: "PASSKEY_INVALID_SIGNATURE",
                                message: "Invalid passkey signature.",
                              });
                        },
                        [coseAlgorithmRS256]: () => {
                          const rsaPublicKey =
                            decodePKCS1RSAPublicKey(storedPublicKeyBytes);
                          const valid = verifyRSASSAPKCS1v15Signature(
                            rsaPublicKey,
                            sha256ObjectIdentifier,
                            messageHash,
                            signature,
                          );
                          return valid
                            ? Fx.succeed(undefined as void)
                            : Cv.fail({
                                code: "PASSKEY_INVALID_SIGNATURE",
                                message: "Invalid passkey signature.",
                              });
                        },
                      };

                      const handler = algorithmHandlers[passkey.algorithm];
                      return handler
                        ? handler()
                        : Cv.fail({
                            code: "PASSKEY_UNSUPPORTED_ALGORITHM",
                            message: `Unsupported algorithm: ${passkey.algorithm}`,
                          });
                    }),
                  );

                  const counterValidatedFx = signatureVerifiedFx.pipe(
                    Fx.chain(() =>
                      passkey.counter !== 0 &&
                      authenticatorData.signatureCounter !== 0 &&
                      authenticatorData.signatureCounter <= passkey.counter
                        ? Cv.fail({
                            code: "PASSKEY_COUNTER_ERROR",
                            message:
                              "Authenticator counter did not increase — possible credential cloning detected.",
                          })
                        : Fx.succeed(authenticatorData),
                    ),
                  );

                  return counterValidatedFx.pipe(
                    Fx.chain(() =>
                      Fx.from({
                        ok: async () => {
                          await mutatePasskeyUpdateCounter(
                            ctx,
                            passkey._id,
                            authenticatorData.signatureCounter,
                            Date.now(),
                          );

                          const signInResult = await callSignIn(ctx, {
                            userId: passkey.userId,
                            generateTokens: true,
                          });

                          return {
                            kind: "signedIn" as const,
                            signedIn: signInResult,
                          };
                        },
                        err: () =>
                          Cv.error({
                            code: "INTERNAL_ERROR",
                            message: "An unexpected error occurred.",
                          }),
                      }),
                    ),
                  );
                }),
              );
            }),
          ),
      });
      return flowFx;
    }),
  );
}
