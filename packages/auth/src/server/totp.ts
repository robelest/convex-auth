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

import { authFlowError } from "../shared/errors";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { userIdFromIdentitySubject } from "./identity";
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

function resolveTotpFlow(
  params: Record<string, unknown>,
): TotpFlow {
  const flow = params.flow;
  if (typeof flow === "string" && TOTP_FLOWS.includes(flow as never)) {
    return flow as TotpFlow;
  }
  throw convexError(
    "TOTP_MISSING_FLOW",
    "Missing `flow` parameter. Expected one of: setup, confirm, verify",
  );
}

function requireTotpVerifier(
  verifier: string | undefined,
): string {
  if (verifier != null) {
    return verifier;
  }
  throw convexError(
    "TOTP_MISSING_VERIFIER",
    "Missing verifier for TOTP operation.",
  );
}

function requireTotpCode(
  params: Record<string, unknown>,
): string {
  if (typeof params.code === "string") {
    return params.code;
  }
  throw convexError("TOTP_MISSING_CODE", "Missing TOTP code.");
}

function requireTotpId(
  params: Record<string, unknown>,
): string {
  if (typeof params.totpId === "string") {
    return params.totpId;
  }
  throw convexError("TOTP_MISSING_ID", "Missing TOTP enrollment ID.");
}

function resolveTotpDispatch(
  params: Record<string, unknown>,
  verifier: string | undefined,
): TotpDispatch {
  const flow = resolveTotpFlow(params);
  if (flow === "setup") {
    return { flow: "setup" as const, params };
  }
  if (flow === "confirm") {
    const resolvedVerifier = requireTotpVerifier(verifier);
    const code = requireTotpCode(params);
    const totpId = requireTotpId(params);
    return {
      flow: "confirm" as const,
      code,
      totpId,
      verifier: resolvedVerifier,
    };
  }
  // flow === "verify"
  const resolvedVerifier = requireTotpVerifier(verifier);
  const code = requireTotpCode(params);
  return {
    flow: "verify" as const,
    code,
    verifier: resolvedVerifier,
  };
}

async function requireAuthenticatedUserId(
  ctx: EnrichedActionCtx,
): Promise<string> {
  let identity;
  try {
    identity = await ctx.auth.getUserIdentity();
  } catch (error) {
    throw asConvexError(error, "INTERNAL_ERROR", String(error));
  }
  if (identity === null) {
    throw convexError(
      "TOTP_AUTH_REQUIRED",
      "Sign in first, then set up two-factor authentication.",
    );
  }
  return userIdFromIdentitySubject(identity.subject);
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
          throw asConvexError(
            error,
            "INTERNAL_ERROR",
            `TOTP setup failed: ${String(error)}`,
          );
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

      let verifier: string;
      try {
        verifier = await callVerifier(
          ctx,
          JSON.stringify({
            secret: Array.from(secret),
            userId,
            digits: provider.options.digits,
            period: provider.options.period,
          }),
        );
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          `TOTP setup failed: ${String(error)}`,
        );
      }

      let totpId: string;
      try {
        totpId = await mutateTotpInsert(ctx, {
          userId,
          secret: secret.buffer.slice(
            secret.byteOffset,
            secret.byteOffset + secret.byteLength,
          ),
          digits: provider.options.digits,
          period: provider.options.period,
          verified: false,
          name:
            typeof setupParams.name === "string" ? setupParams.name : undefined,
          createdAt: Date.now(),
        });
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          `TOTP setup failed: ${String(error)}`,
        );
      }

      return {
        kind: "totpSetup" as const,
        uri,
        secret: base32Secret,
        verifier,
        totpId,
      };
    },

    confirm: async () => {
      const { code, totpId, verifier } = dispatch as { code: string; totpId: string; verifier: string };
      const userId = await requireAuthenticatedUserId(ctx);
      let doc;
      try {
        doc = await queryTotpById(ctx, totpId);
      } catch {
        throw convexError("TOTP_NOT_FOUND", "TOTP enrollment not found.");
      }
      if (doc === null) {
        throw convexError("TOTP_NOT_FOUND", "TOTP enrollment not found.");
      }
      if (doc.verified) {
        throw convexError(
          "TOTP_ALREADY_VERIFIED",
          "TOTP enrollment is already verified.",
        );
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
      return { kind: "signedIn" as const, signedIn: signInResult };
    },

    verify: async () => {
      const { code, verifier } = dispatch as { code: string; verifier: string };
      let doc;
      try {
        doc = await queryVerifierById(ctx, verifier);
      } catch {
        throw convexError(
          "TOTP_INVALID_VERIFIER",
          "Invalid or expired TOTP verifier.",
        );
      }
      if (doc === null) {
        throw convexError(
          "TOTP_INVALID_VERIFIER",
          "Invalid or expired TOTP verifier.",
        );
      }
      const data = JSON.parse(doc.signature!);
      const userId = data.userId as string;

      let totp;
      try {
        totp = await queryTotpVerifiedByUserId(ctx, userId);
      } catch {
        throw convexError(
          "TOTP_NO_ENROLLMENT",
          "No verified TOTP enrollment found.",
        );
      }
      if (totp === null) {
        throw convexError(
          "TOTP_NO_ENROLLMENT",
          "No verified TOTP enrollment found.",
        );
      }
      if (
        !verifyTOTPWithGracePeriod(
          new Uint8Array(totp.secret),
          totp.period,
          totp.digits,
          code,
          30,
        )
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
      return { kind: "signedIn" as const, signedIn: signInResult };
    },
  };

  const handler = flowHandlers[dispatch.flow];
  if (!handler) {
    throw convexError("TOTP_MISSING_FLOW", `Unknown TOTP flow: ${dispatch.flow}`);
  }
  return handler();
};
