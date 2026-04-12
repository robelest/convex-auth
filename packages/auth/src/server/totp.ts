/**
 * Server-side TOTP ceremony logic for two-factor authentication.
 *
 * Handles the three phases of the TOTP flow:
 * 1. setup   — generate a TOTP secret and `otpauth://` URI for enrollment
 * 2. confirm — verify the first code from the authenticator app
 * 3. verify  — verify a TOTP code during sign-in (2FA challenge)
 */

import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { ConvexError } from "convex/values";
import { Effect, Match } from "effect";

import { authFlowError } from "../shared/errors";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { userIdFromIdentitySubject } from "./identity";
import { callSignIn, callVerifier } from "./mutations/index";
import { callVerifierSignature } from "./mutations/signature";
import { GenericActionCtxWithAuthConfig, TotpProviderConfig } from "./types";
import {
  AuthDataModel,
  SessionInfo,
  mutateTotpInsert,
  mutateTotpMarkVerified,
  mutateTotpUpdateLastUsed,
  mutateVerifierDelete,
  queryTotpById,
  queryTotpVerifiedByUserId,
  queryUserById,
  queryVerifierById,
} from "./types";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

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

const resolveTotpFlowFx = (
  params: Record<string, unknown>,
): Effect.Effect<TotpFlow, ConvexError<AuthErrorData>> => {
  const flow = params.flow;
  return typeof flow === "string" && TOTP_FLOWS.includes(flow as never)
    ? Effect.succeed(flow as TotpFlow)
    : Effect.fail(
        convexError(
          "TOTP_MISSING_FLOW",
          "Missing `flow` parameter. Expected one of: setup, confirm, verify",
        ),
      );
};

const requireTotpVerifierFx = (
  verifier: string | undefined,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  verifier != null
    ? Effect.succeed(verifier)
    : Effect.fail(
        convexError(
          "TOTP_MISSING_VERIFIER",
          "Missing verifier for TOTP operation.",
        ),
      );

const requireTotpCodeFx = (
  params: Record<string, unknown>,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  typeof params.code === "string"
    ? Effect.succeed(params.code)
    : Effect.fail(convexError("TOTP_MISSING_CODE", "Missing TOTP code."));

const requireTotpIdFx = (
  params: Record<string, unknown>,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  typeof params.totpId === "string"
    ? Effect.succeed(params.totpId)
    : Effect.fail(
        convexError("TOTP_MISSING_ID", "Missing TOTP enrollment ID."),
      );

const resolveTotpDispatchFx = (
  params: Record<string, unknown>,
  verifier: string | undefined,
): Effect.Effect<TotpDispatch, ConvexError<AuthErrorData>> =>
  Effect.flatMap(resolveTotpFlowFx(params), (flow) =>
    Match.value(flow).pipe(
      Match.when("setup", () =>
        Effect.succeed({ flow: "setup" as const, params }),
      ),
      Match.when("confirm", () =>
        Effect.gen(function* () {
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
      ),
      Match.when("verify", () =>
        Effect.gen(function* () {
          const resolvedVerifier = yield* requireTotpVerifierFx(verifier);
          const code = yield* requireTotpCodeFx(params);
          return {
            flow: "verify" as const,
            code,
            verifier: resolvedVerifier,
          };
        }),
      ),
      Match.exhaustive,
    ),
  );

const requireAuthenticatedUserId = (
  ctx: EnrichedActionCtx,
): Effect.Effect<string, ConvexError<AuthErrorData>> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: () => ctx.auth.getUserIdentity(),
      catch: (error) => asConvexError(error, "INTERNAL_ERROR", String(error)),
    }),
    (identity) =>
      Match.value(identity).pipe(
        Match.when(null, () =>
          Effect.fail(
            convexError(
              "TOTP_AUTH_REQUIRED",
              "Sign in first, then set up two-factor authentication.",
            ),
          ),
        ),
        Match.orElse((identity) =>
          Effect.succeed(userIdFromIdentitySubject(identity.subject)),
        ),
      ),
  );

/** @internal */
export const handleTotp = (
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  args: { params?: Record<string, unknown>; verifier?: string },
): Effect.Effect<TotpResult, ConvexError<AuthErrorData>> => {
  const params = (args.params ?? {}) as Record<string, unknown>;

  return Effect.flatMap(resolveTotpDispatchFx(params, args.verifier), (dispatch) =>
    Match.value(dispatch).pipe(
      Match.when({ flow: "setup" }, ({ params }) =>
        Effect.gen(function* () {
          const userId = yield* requireAuthenticatedUserId(ctx);
          const secret = new Uint8Array(20);
          crypto.getRandomValues(secret);

          let accountName: string = params.accountName as string;
          if (!accountName) {
            const user = yield* Effect.tryPromise({
              try: () => queryUserById(ctx, userId),
              catch: (error) =>
                asConvexError(
                  error,
                  "INTERNAL_ERROR",
                  `TOTP setup failed: ${String(error)}`,
                ),
            });
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

          const verifier = yield* Effect.tryPromise({
            try: () => callVerifier(ctx),
            catch: (error) =>
              asConvexError(
                error,
                "INTERNAL_ERROR",
                `TOTP setup failed: ${String(error)}`,
              ),
          });
          yield* Effect.tryPromise({
            try: () =>
              callVerifierSignature(ctx, {
                verifier,
                signature: JSON.stringify({
                  secret: Array.from(secret),
                  userId,
                  digits: provider.options.digits,
                  period: provider.options.period,
                }),
              }),
            catch: (error) =>
              asConvexError(
                error,
                "INTERNAL_ERROR",
                `TOTP setup failed: ${String(error)}`,
              ),
          });

          const totpId = yield* Effect.tryPromise({
            try: () =>
              mutateTotpInsert(ctx, {
                userId,
                secret: secret.buffer.slice(
                  secret.byteOffset,
                  secret.byteOffset + secret.byteLength,
                ),
                digits: provider.options.digits,
                period: provider.options.period,
                verified: false,
                name: typeof params.name === "string" ? params.name : undefined,
                createdAt: Date.now(),
              }),
            catch: (error) =>
              asConvexError(
                error,
                "INTERNAL_ERROR",
                `TOTP setup failed: ${String(error)}`,
              ),
          });

          return {
            kind: "totpSetup" as const,
            uri,
            secret: base32Secret,
            verifier,
            totpId,
          };
        }),
      ),
      Match.when({ flow: "confirm" }, ({ code, totpId, verifier }) =>
        Effect.gen(function* () {
          const userId = yield* requireAuthenticatedUserId(ctx);
          const doc = yield* Effect.tryPromise({
            try: () => queryTotpById(ctx, totpId),
            catch: () =>
              convexError("TOTP_NOT_FOUND", "TOTP enrollment not found."),
          });
          const totpDoc = yield* Match.value(doc).pipe(
            Match.when(null, () =>
              Effect.fail(
                convexError("TOTP_NOT_FOUND", "TOTP enrollment not found."),
              ),
            ),
            Match.orElse((doc) => Effect.succeed(doc)),
          );
          if (totpDoc.verified) {
            return yield* Effect.fail(
              convexError(
                "TOTP_ALREADY_VERIFIED",
                "TOTP enrollment is already verified.",
              ),
            );
          }
          if (
            !verifyTOTPWithGracePeriod(
              new Uint8Array(totpDoc.secret),
              provider.options.period,
              provider.options.digits,
              code,
              30,
            )
          ) {
            return yield* Effect.fail(
              convexError("TOTP_INVALID_CODE", "Invalid TOTP code."),
            );
          }
          const signInResult = yield* Effect.tryPromise({
            try: async () => {
              await mutateTotpMarkVerified(ctx, totpId, Date.now());
              await mutateVerifierDelete(ctx, verifier);
              return callSignIn(ctx, {
                userId,
                generateTokens: true,
              });
            },
            catch: (error) =>
              asConvexError(error, "INTERNAL_ERROR", String(error)),
          });
          return { kind: "signedIn" as const, signedIn: signInResult };
        }),
      ),
      Match.when({ flow: "verify" }, ({ code, verifier }) =>
        Effect.gen(function* () {
          const doc = yield* Effect.tryPromise({
            try: () => queryVerifierById(ctx, verifier),
            catch: () =>
              convexError(
                "TOTP_INVALID_VERIFIER",
                "Invalid or expired TOTP verifier.",
              ),
          });
          const verifierDoc = yield* Match.value(doc).pipe(
            Match.when(null, () =>
              Effect.fail(
                convexError(
                  "TOTP_INVALID_VERIFIER",
                  "Invalid or expired TOTP verifier.",
                ),
              ),
            ),
            Match.orElse((doc) => Effect.succeed(doc)),
          );
          const data = JSON.parse(verifierDoc.signature!);
          const userId = data.userId as string;

          const totp = yield* Effect.tryPromise({
            try: () => queryTotpVerifiedByUserId(ctx, userId),
            catch: () =>
              convexError(
                "TOTP_NO_ENROLLMENT",
                "No verified TOTP enrollment found.",
              ),
          });
          const totpDoc = yield* Match.value(totp).pipe(
            Match.when(null, () =>
              Effect.fail(
                convexError(
                  "TOTP_NO_ENROLLMENT",
                  "No verified TOTP enrollment found.",
                ),
              ),
            ),
            Match.orElse((doc) => Effect.succeed(doc)),
          );
          if (
            !verifyTOTPWithGracePeriod(
              new Uint8Array(totpDoc.secret),
              totpDoc.period,
              totpDoc.digits,
              code,
              30,
            )
          ) {
            return yield* Effect.fail(
              convexError("TOTP_INVALID_CODE", "Invalid TOTP code."),
            );
          }

          const signInResult = yield* Effect.tryPromise({
            try: async () => {
              await mutateTotpUpdateLastUsed(ctx, totpDoc._id, Date.now());
              await mutateVerifierDelete(ctx, verifier);
              return callSignIn(ctx, { userId, generateTokens: true });
            },
            catch: (error) =>
              asConvexError(error, "INTERNAL_ERROR", String(error)),
          });
          return { kind: "signedIn" as const, signedIn: signInResult };
        }),
      ),
      Match.exhaustive,
    ),
  );
};
