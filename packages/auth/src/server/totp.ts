/**
 * Server-side TOTP ceremony logic for two-factor authentication.
 *
 * Two single-word flows:
 *
 * - `setup`  — generate a TOTP secret and `otpauth://` URI for enrollment.
 * - `verify` — consume a TOTP code. Auto-detects:
 *     - first-time enrollment confirmation (caller passes `totpId`), or
 *     - 2FA sign-in challenge (no `totpId`).
 */

import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { ConvexError, type GenericId } from "convex/values";

import { authFlowError } from "../shared/errors";
import type { AuthTokens, SignInSessionResult, SignInTotpSetupResult } from "../shared/results";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { getAuthenticatedUserIdOrNull } from "./identity";
import { callSignIn, callVerifier } from "./mutations/index";
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
  | SignInSessionResult<SessionInfo<AuthTokens | null> | null>
  | SignInTotpSetupResult;

const TOTP_FLOWS = ["setup", "verify"] as const;

type TotpFlow = (typeof TOTP_FLOWS)[number];

type TotpDispatch =
  | { flow: "setup"; params: Record<string, unknown> }
  /** Enrollment confirmation — `totpId` distinguishes from a 2FA challenge. */
  | { flow: "verify"; code: string; verifier: string; totpId: string; intent: "enrollment" }
  /** 2FA challenge during sign-in. */
  | { flow: "verify"; code: string; verifier: string; totpId?: undefined; intent: "challenge" };

const convexError = (code: string, message: string) => toConvexError(authFlowError(code, message));

const asConvexError = (error: unknown, code: string, message: string): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? error
    : error instanceof Error
      ? toConvexError(authFlowError(code, error.message || message))
      : convexError(code, message);

function resolveTotpFlow(params: Record<string, unknown>): TotpFlow {
  const flow = params.flow;
  if (typeof flow === "string" && (TOTP_FLOWS as readonly string[]).includes(flow)) {
    return flow as TotpFlow;
  }
  throw convexError(
    "TOTP_MISSING_FLOW",
    "Missing `flow` parameter. Expected one of: " + TOTP_FLOWS.join(", "),
  );
}

function requireTotpVerifier(verifier: string | undefined): string {
  if (verifier != null) {
    return verifier;
  }
  throw convexError("TOTP_MISSING_VERIFIER", "Missing verifier for TOTP operation.");
}

function requireTotpCode(params: Record<string, unknown>): string {
  if (typeof params.code === "string") {
    return params.code;
  }
  throw convexError("TOTP_MISSING_CODE", "Missing TOTP code.");
}

function resolveTotpDispatch(
  params: Record<string, unknown>,
  verifier: string | undefined,
): TotpDispatch {
  const flow = resolveTotpFlow(params);
  if (flow === "setup") {
    return { flow: "setup" as const, params };
  }
  // flow === "verify" — discriminate by `totpId` presence.
  const resolvedVerifier = requireTotpVerifier(verifier);
  const code = requireTotpCode(params);
  if (typeof params.totpId === "string" && params.totpId.length > 0) {
    return {
      flow: "verify" as const,
      code,
      totpId: params.totpId,
      verifier: resolvedVerifier,
      intent: "enrollment",
    };
  }
  return {
    flow: "verify" as const,
    code,
    verifier: resolvedVerifier,
    intent: "challenge",
  };
}

async function requireAuthenticatedUserId(ctx: EnrichedActionCtx): Promise<string> {
  try {
    const userId = await getAuthenticatedUserIdOrNull(ctx);
    if (userId === null) {
      throw convexError(
        "TOTP_AUTH_REQUIRED",
        "Sign in first, then set up two-factor authentication.",
      );
    }
    return userId;
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    throw asConvexError(error, "INTERNAL_ERROR", String(error));
  }
}

/** @internal */
export const handleTotp = async (
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  args: { params?: Record<string, unknown>; verifier?: string },
): Promise<TotpResult> => {
  const params = (args.params ?? {}) as Record<string, unknown>;
  const dispatch = resolveTotpDispatch(params, args.verifier);

  const flowHandlers: Record<string, () => Promise<TotpResult>> = {
    setup: async () => {
      const { params: setupParams } = dispatch as { params: Record<string, unknown> };
      const userId = await requireAuthenticatedUserId(ctx);
      const secret = new Uint8Array(20);
      crypto.getRandomValues(secret);

      let accountName: string = setupParams.accountName as string;
      if (!accountName) {
        let user;
        try {
          user = await queryUserById(ctx, userId);
        } catch (error) {
          throw asConvexError(error, "INTERNAL_ERROR", `TOTP setup failed: ${String(error)}`);
        }
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

      let totpId: string;
      try {
        totpId = await mutateTotpInsert(ctx, {
          userId,
          secret: secret.buffer.slice(secret.byteOffset, secret.byteOffset + secret.byteLength),
          digits: provider.options.digits,
          period: provider.options.period,
          verified: false,
          name: typeof setupParams.name === "string" ? setupParams.name : undefined,
          createdAt: Date.now(),
        });
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", `TOTP setup failed: ${String(error)}`);
      }

      let verifier: string;
      try {
        verifier = await callVerifier(
          ctx,
          JSON.stringify({
            purpose: "totp.setup",
            secret: Array.from(secret),
            userId,
            totpId,
            digits: provider.options.digits,
            period: provider.options.period,
          }),
        );
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", `TOTP setup failed: ${String(error)}`);
      }

      return {
        kind: "totpSetup" as const,
        totpSetup: {
          uri,
          secret: base32Secret,
          totpId,
        },
        verifier,
      };
    },

    verify: async () => {
      if (dispatch.flow !== "verify") {
        throw convexError("TOTP_MISSING_FLOW", `Unexpected dispatch: ${dispatch.flow}`);
      }
      if (dispatch.intent === "enrollment") {
        return await confirmEnrollment(dispatch.code, dispatch.totpId, dispatch.verifier);
      }
      return await verifyChallenge(dispatch.code, dispatch.verifier);
    },
  };

  /**
   * `verify` with `totpId`: completes a first-time enrollment after `setup`.
   * Marks the TOTP factor as verified and signs the user in.
   */
  async function confirmEnrollment(
    code: string,
    totpId: string,
    verifier: string,
  ): Promise<TotpResult> {
    const userId = await requireAuthenticatedUserId(ctx);
    let verifierDoc;
    try {
      verifierDoc = await queryVerifierById(ctx, verifier);
    } catch {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    if (verifierDoc === null) {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    let verifierData: Record<string, unknown>;
    try {
      verifierData = JSON.parse(verifierDoc.signature!);
    } catch {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    if (
      verifierData.purpose !== "totp.setup" ||
      verifierData.userId !== userId ||
      verifierData.totpId !== totpId
    ) {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    let doc;
    try {
      doc = await queryTotpById(ctx, totpId);
    } catch {
      throw convexError("TOTP_NOT_FOUND", "TOTP enrollment not found.");
    }
    if (doc === null) {
      throw convexError("TOTP_NOT_FOUND", "TOTP enrollment not found.");
    }
    if (doc.userId !== userId) {
      throw convexError("TOTP_NOT_FOUND", "TOTP enrollment not found.");
    }
    if (doc.verified) {
      throw convexError("TOTP_ALREADY_VERIFIED", "TOTP enrollment is already verified.");
    }
    if (
      !verifyTOTPWithGracePeriod(
        new Uint8Array(doc.secret),
        provider.options.period,
        provider.options.digits,
        code,
        30,
      )
    ) {
      throw convexError("TOTP_INVALID_CODE", "Invalid TOTP code.");
    }
    let signInResult;
    try {
      await mutateTotpMarkVerified(ctx, totpId, Date.now());
      await mutateVerifierDelete(ctx, verifier);
      signInResult = await callSignIn(ctx, {
        userId,
        generateTokens: true,
      });
    } catch (error) {
      throw asConvexError(error, "INTERNAL_ERROR", String(error));
    }
    await ctx.auth.config.callbacks?.after?.(ctx, {
      kind: "totpEnrolled",
      userId: userId as GenericId<"User">,
      totpId: totpId as GenericId<"TotpFactor">,
    });
    return { kind: "signedIn" as const, session: signInResult };
  }

  /**
   * `verify` without `totpId`: completes a 2FA challenge during sign-in.
   * Looks up the user's verified TOTP factor, validates the code, signs in.
   */
  async function verifyChallenge(code: string, verifier: string): Promise<TotpResult> {
    let doc;
    try {
      doc = await queryVerifierById(ctx, verifier);
    } catch {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    if (doc === null) {
      throw convexError("TOTP_INVALID_VERIFIER", "Invalid or expired TOTP verifier.");
    }
    const data = JSON.parse(doc.signature!);
    const userId = data.userId as string;

    let totp;
    try {
      totp = await queryTotpVerifiedByUserId(ctx, userId);
    } catch {
      throw convexError("TOTP_NO_ENROLLMENT", "No verified TOTP enrollment found.");
    }
    if (totp === null) {
      throw convexError("TOTP_NO_ENROLLMENT", "No verified TOTP enrollment found.");
    }
    if (
      !verifyTOTPWithGracePeriod(new Uint8Array(totp.secret), totp.period, totp.digits, code, 30)
    ) {
      throw convexError("TOTP_INVALID_CODE", "Invalid TOTP code.");
    }

    let signInResult;
    try {
      await mutateTotpUpdateLastUsed(ctx, totp._id, Date.now());
      await mutateVerifierDelete(ctx, verifier);
      signInResult = await callSignIn(ctx, { userId, generateTokens: true });
    } catch (error) {
      throw asConvexError(error, "INTERNAL_ERROR", String(error));
    }
    return { kind: "signedIn" as const, session: signInResult };
  }

  const handler = flowHandlers[dispatch.flow];
  if (!handler) {
    throw convexError("TOTP_MISSING_FLOW", `Unknown TOTP flow: ${dispatch.flow}`);
  }
  return handler();
};
