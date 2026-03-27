/**
 * Server-side TOTP ceremony logic for two-factor authentication.
 *
 * Handles the three phases of the TOTP flow:
 * 1. setup   — generate a TOTP secret and `otpauth://` URI for enrollment
 * 2. confirm — verify the first code from the authenticator app
 * 3. verify  — verify a TOTP code during sign-in (2FA challenge)
 */

import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { verifyTOTPWithGracePeriod, createTOTPKeyURI } from "@oslojs/otp";
import type { Fx as FxType } from "@robelest/fx";
import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { ConvexError } from "convex/values";

import { userIdFromIdentitySubject } from "./identity";
import { callSignIn, callVerifier } from "./mutations/index";
import { callVerifierSignature } from "./mutations/signature";
import { TotpProviderConfig, GenericActionCtxWithAuthConfig } from "./types";
import {
  AuthDataModel,
  SessionInfo,
  queryUserById,
  queryTotpById,
  queryTotpVerifiedByUserId,
  queryVerifierById,
  mutateTotpInsert,
  mutateTotpMarkVerified,
  mutateTotpUpdateLastUsed,
  mutateVerifierDelete,
} from "./types";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

// ============================================================================
// Setup flow
// ============================================================================

// ============================================================================
// Confirm flow
// ============================================================================

// ============================================================================
// Verify flow (2FA during sign-in)
// ============================================================================

// ============================================================================
// Main dispatch
// ============================================================================

type TotpResult =
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | {
      kind: "totpSetup";
      uri: string;
      secret: string;
      verifier: string;
      totpId: string;
    };

const TOTP_FLOWS = ["setup", "confirm", "verify"] as const;

type TotpFlow = (typeof TOTP_FLOWS)[number];

type TotpDispatch =
  | { flow: "setup"; params: Record<string, unknown> }
  | { flow: "confirm"; code: string; totpId: string; verifier: string }
  | { flow: "verify"; code: string; verifier: string };

const resolveTotpFlowFx = (
  params: Record<string, unknown>,
): FxType<TotpFlow, ConvexError<any>> => {
  const flow = params.flow;
  return typeof flow === "string" && TOTP_FLOWS.includes(flow as never)
    ? Fx.succeed(flow as TotpFlow)
    : Cv.fail({
        code: "TOTP_MISSING_FLOW",
        message:
          "Missing `flow` parameter. Expected one of: setup, confirm, verify",
      });
};

const requireTotpVerifierFx = (
  verifier: string | undefined,
): FxType<string, ConvexError<any>> =>
  verifier != null
    ? Fx.succeed(verifier)
    : Cv.fail({
        code: "TOTP_MISSING_VERIFIER",
        message: "Missing verifier for TOTP operation.",
      });

const requireTotpCodeFx = (
  params: Record<string, unknown>,
): FxType<string, ConvexError<any>> =>
  typeof params.code === "string"
    ? Fx.succeed(params.code)
    : Cv.fail({ code: "TOTP_MISSING_CODE", message: "Missing TOTP code." });

const requireTotpIdFx = (
  params: Record<string, unknown>,
): FxType<string, ConvexError<any>> =>
  typeof params.totpId === "string"
    ? Fx.succeed(params.totpId)
    : Cv.fail({
        code: "TOTP_MISSING_ID",
        message: "Missing TOTP enrollment ID.",
      });

const resolveTotpDispatchFx = (
  params: Record<string, unknown>,
  verifier: string | undefined,
): FxType<TotpDispatch, ConvexError<any>> =>
  resolveTotpFlowFx(params).pipe(
    Fx.chain((flow) =>
      Fx.match({ flow }).on("flow", {
        setup: () => Fx.succeed({ flow: "setup" as const, params }),
        confirm: () =>
          Fx.gen(function* () {
            const resolvedVerifier = yield* requireTotpVerifierFx(verifier);
            const code = yield* requireTotpCodeFx(params);
            const totpId = yield* requireTotpIdFx(params);
            return {
              flow: "confirm" as const,
              code,
              totpId,
              verifier: resolvedVerifier,
            };
          }),
        verify: () =>
          Fx.gen(function* () {
            const resolvedVerifier = yield* requireTotpVerifierFx(verifier);
            const code = yield* requireTotpCodeFx(params);
            return {
              flow: "verify" as const,
              code,
              verifier: resolvedVerifier,
            };
          }),
      }),
    ),
  );

/** @internal */
export const handleTotp = (
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  args: { params?: Record<string, any>; verifier?: string },
): FxType<TotpResult, ConvexError<any>> => {
  const params = (args.params ?? {}) as Record<string, unknown>;

  return resolveTotpDispatchFx(params, args.verifier).pipe(
    Fx.chain((dispatch) =>
      Fx.match(dispatch).on("flow", {
        setup: ({ params }) =>
          Fx.from({
            ok: () => ctx.auth.getUserIdentity(),
            err: (e) =>
              Cv.error({ code: "INTERNAL_ERROR", message: String(e) }),
          }).pipe(
            Fx.chain((identity) =>
              identity === null
                ? Cv.fail({
                    code: "TOTP_AUTH_REQUIRED",
                    message:
                      "Sign in first, then set up two-factor authentication.",
                  })
                : Fx.succeed(userIdFromIdentitySubject(identity.subject)),
            ),
            Fx.chain((userId) =>
              Fx.from({
                ok: async () => {
                  const secret = new Uint8Array(20);
                  crypto.getRandomValues(secret);

                  let accountName: string = params.accountName as string;
                  if (!accountName) {
                    const user = await queryUserById(ctx, userId);
                    accountName = user?.email ?? "user";
                  }

                  const uri = createTOTPKeyURI(
                    provider.options.issuer,
                    accountName,
                    secret,
                    provider.options.period,
                    provider.options.digits,
                  );
                  const base32Secret = encodeBase32LowerCaseNoPadding(secret);

                  const verifier = await callVerifier(ctx);
                  await callVerifierSignature(ctx, {
                    verifier,
                    signature: JSON.stringify({
                      secret: Array.from(secret),
                      userId,
                      digits: provider.options.digits,
                      period: provider.options.period,
                    }),
                  });

                  const totpId = await mutateTotpInsert(ctx, {
                    userId,
                    secret: secret.buffer.slice(
                      secret.byteOffset,
                      secret.byteOffset + secret.byteLength,
                    ),
                    digits: provider.options.digits,
                    period: provider.options.period,
                    verified: false,
                    name:
                      typeof params.name === "string" ? params.name : undefined,
                    createdAt: Date.now(),
                  });

                  return {
                    kind: "totpSetup" as const,
                    uri,
                    secret: base32Secret,
                    verifier,
                    totpId,
                  };
                },
                err: (e) =>
                  Cv.error({
                    code: "INTERNAL_ERROR",
                    message: `TOTP setup failed: ${String(e)}`,
                  }),
              }),
            ),
          ),
        confirm: ({ code, totpId, verifier }) =>
          Fx.from({
            ok: () => ctx.auth.getUserIdentity(),
            err: (e) =>
              Cv.error({ code: "INTERNAL_ERROR", message: String(e) }),
          }).pipe(
            Fx.chain((identity) =>
              identity === null
                ? Cv.fail({
                    code: "TOTP_AUTH_REQUIRED",
                    message:
                      "Sign in first, then set up two-factor authentication.",
                  })
                : Fx.succeed(userIdFromIdentitySubject(identity.subject)),
            ),
            Fx.chain((userId) =>
              Fx.from({
                ok: () => queryTotpById(ctx, totpId),
                err: () =>
                  Cv.error({
                    code: "TOTP_NOT_FOUND",
                    message: "TOTP enrollment not found.",
                  }),
              })
                .pipe(
                  Fx.chain((doc) =>
                    doc === null
                      ? Cv.fail({
                          code: "TOTP_NOT_FOUND",
                          message: "TOTP enrollment not found.",
                        })
                      : Fx.succeed(doc),
                  ),
                  Fx.chain((totpDoc) =>
                    totpDoc.verified
                      ? Cv.fail({
                          code: "TOTP_ALREADY_VERIFIED",
                          message: "TOTP enrollment is already verified.",
                        })
                      : Fx.succeed(totpDoc),
                  ),
                )
                .pipe(
                  Fx.chain((totpDoc) =>
                    verifyTOTPWithGracePeriod(
                      new Uint8Array(totpDoc.secret),
                      provider.options.period,
                      provider.options.digits,
                      code,
                      30,
                    )
                      ? Fx.succeed(totpDoc)
                      : Cv.fail({
                          code: "TOTP_INVALID_CODE",
                          message: "Invalid TOTP code.",
                        }),
                  ),
                )
                .pipe(
                  Fx.chain((_totpDoc) =>
                    Fx.from({
                      ok: async () => {
                        await mutateTotpMarkVerified(ctx, totpId, Date.now());
                        await mutateVerifierDelete(ctx, verifier);
                        return callSignIn(ctx, {
                          userId,
                          generateTokens: true,
                        });
                      },
                      err: (e) =>
                        Cv.error({
                          code: "INTERNAL_ERROR",
                          message: String(e),
                        }),
                    }),
                  ),
                )
                .pipe(
                  Fx.map((signInResult) => ({
                    kind: "signedIn" as const,
                    signedIn: signInResult,
                  })),
                ),
            ),
          ),
        verify: ({ code, verifier }) =>
          Fx.from({
            ok: () => queryVerifierById(ctx, verifier),
            err: () =>
              Cv.error({
                code: "TOTP_INVALID_VERIFIER",
                message: "Invalid or expired TOTP verifier.",
              }),
          }).pipe(
            Fx.chain((doc) =>
              doc === null
                ? Cv.fail({
                    code: "TOTP_INVALID_VERIFIER",
                    message: "Invalid or expired TOTP verifier.",
                  })
                : Fx.succeed(doc),
            ),
            Fx.map((doc) => {
              const data = JSON.parse(doc.signature!);
              return { userId: data.userId as string, code, verifier };
            }),
            Fx.chain(({ userId, code, verifier }) =>
              Fx.from({
                ok: () => queryTotpVerifiedByUserId(ctx, userId),
                err: () =>
                  Cv.error({
                    code: "TOTP_NO_ENROLLMENT",
                    message: "No verified TOTP enrollment found.",
                  }),
              }).pipe(
                Fx.chain((totpDoc) =>
                  totpDoc === null
                    ? Cv.fail({
                        code: "TOTP_NO_ENROLLMENT",
                        message: "No verified TOTP enrollment found.",
                      })
                    : Fx.succeed(totpDoc),
                ),
                Fx.chain((totpDoc) =>
                  verifyTOTPWithGracePeriod(
                    new Uint8Array(totpDoc.secret),
                    totpDoc.period,
                    totpDoc.digits,
                    code,
                    30,
                  )
                    ? Fx.succeed(totpDoc)
                    : Cv.fail({
                        code: "TOTP_INVALID_CODE",
                        message: "Invalid TOTP code.",
                      }),
                ),
                Fx.chain((totpDoc) =>
                  Fx.from({
                    ok: async () => {
                      await mutateTotpUpdateLastUsed(
                        ctx,
                        totpDoc._id,
                        Date.now(),
                      );
                      await mutateVerifierDelete(ctx, verifier);
                      return callSignIn(ctx, { userId, generateTokens: true });
                    },
                    err: (e) =>
                      Cv.error({ code: "INTERNAL_ERROR", message: String(e) }),
                  }),
                ),
                Fx.map((signInResult) => ({
                  kind: "signedIn" as const,
                  signedIn: signInResult,
                })),
              ),
            ),
          ),
      }),
    ),
  );
};

// ============================================================================
// Helpers
// ============================================================================
