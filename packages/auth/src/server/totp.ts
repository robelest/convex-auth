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

import { AuthError, Fx } from "./fx";
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
): FxType<TotpFlow, AuthError> => {
  const flow = params.flow;
  return typeof flow === "string" && TOTP_FLOWS.includes(flow as never)
    ? Fx.succeed(flow as TotpFlow)
    : Fx.fail(
        new AuthError(
          "TOTP_MISSING_FLOW",
          "Missing `flow` parameter. Expected one of: setup, confirm, verify",
        ),
      );
};

const requireTotpVerifierFx = (
  verifier: string | undefined,
): FxType<string, AuthError> =>
  verifier != null
    ? Fx.succeed(verifier)
    : Fx.fail(new AuthError("TOTP_MISSING_VERIFIER"));

const requireTotpCodeFx = (
  params: Record<string, unknown>,
): FxType<string, AuthError> =>
  typeof params.code === "string"
    ? Fx.succeed(params.code)
    : Fx.fail(new AuthError("TOTP_MISSING_CODE"));

const requireTotpIdFx = (
  params: Record<string, unknown>,
): FxType<string, AuthError> =>
  typeof params.totpId === "string"
    ? Fx.succeed(params.totpId)
    : Fx.fail(new AuthError("TOTP_MISSING_ID"));

const resolveTotpDispatchFx = (
  params: Record<string, unknown>,
  verifier: string | undefined,
): FxType<TotpDispatch, AuthError> =>
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
): FxType<TotpResult, AuthError> => {
  const params = (args.params ?? {}) as Record<string, unknown>;

  return resolveTotpDispatchFx(params, args.verifier).pipe(
    Fx.chain((dispatch) =>
      Fx.match(dispatch).on("flow", {
        setup: ({ params }) =>
          Fx.from({
            ok: () => ctx.auth.getUserIdentity(),
            err: (e) => new AuthError("INTERNAL_ERROR", String(e)),
          }).pipe(
            Fx.chain((identity) =>
              identity === null
                ? Fx.fail(new AuthError("TOTP_AUTH_REQUIRED"))
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
                  new AuthError(
                    "INTERNAL_ERROR",
                    `TOTP setup failed: ${String(e)}`,
                  ),
              }),
            ),
          ),
        confirm: ({ code, totpId, verifier }) =>
          Fx.from({
            ok: () => ctx.auth.getUserIdentity(),
            err: (e) => new AuthError("INTERNAL_ERROR", String(e)),
          }).pipe(
            Fx.chain((identity) =>
              identity === null
                ? Fx.fail(new AuthError("TOTP_AUTH_REQUIRED"))
                : Fx.succeed(userIdFromIdentitySubject(identity.subject)),
            ),
            Fx.chain((userId) =>
              Fx.from({
                ok: () => queryTotpById(ctx, totpId),
                err: () => new AuthError("TOTP_NOT_FOUND"),
              })
                .pipe(
                  Fx.chain((doc) =>
                    doc === null
                      ? Fx.fail(new AuthError("TOTP_NOT_FOUND"))
                      : Fx.succeed(doc),
                  ),
                  Fx.chain((totpDoc) =>
                    totpDoc.verified
                      ? Fx.fail(new AuthError("TOTP_ALREADY_VERIFIED"))
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
                      : Fx.fail(new AuthError("TOTP_INVALID_CODE")),
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
                      err: (e) => new AuthError("INTERNAL_ERROR", String(e)),
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
            err: () => new AuthError("TOTP_INVALID_VERIFIER"),
          }).pipe(
            Fx.chain((doc) =>
              doc === null
                ? Fx.fail(new AuthError("TOTP_INVALID_VERIFIER"))
                : Fx.succeed(doc),
            ),
            Fx.map((doc) => {
              const data = JSON.parse(doc.signature!);
              return { userId: data.userId as string, code, verifier };
            }),
            Fx.chain(({ userId, code, verifier }) =>
              Fx.from({
                ok: () => queryTotpVerifiedByUserId(ctx, userId),
                err: () => new AuthError("TOTP_NO_ENROLLMENT"),
              }).pipe(
                Fx.chain((totpDoc) =>
                  totpDoc === null
                    ? Fx.fail(new AuthError("TOTP_NO_ENROLLMENT"))
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
                    : Fx.fail(new AuthError("TOTP_INVALID_CODE")),
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
                    err: (e) => new AuthError("INTERNAL_ERROR", String(e)),
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
