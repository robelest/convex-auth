/**
 * Server-side TOTP ceremony logic for two-factor authentication.
 *
 * Handles the three phases of the TOTP flow:
 * 1. setup   — generate a TOTP secret and `otpauth://` URI for enrollment
 * 2. confirm — verify the first code from the authenticator app and mark
 *              the enrollment as verified
 * 3. verify  — verify a TOTP code during sign-in (2FA challenge)
 *
 * Uses `@oslojs/otp` for TOTP generation / verification and
 * `@oslojs/encoding` for base-32 secret encoding.
 */

import {
  verifyTOTPWithGracePeriod,
  createTOTPKeyURI,
} from "@oslojs/otp";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import {
  TotpProviderConfig,
  GenericActionCtxWithAuthConfig,
} from "../types";
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
import { callSignIn, callVerifier } from "./mutations/index";
import { callVerifierSignature } from "./mutations/signature";
import { throwAuthError } from "../errors";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

// ============================================================================
// Setup flow
// ============================================================================

/**
 * Phase 1: Generate a TOTP secret and enrollment URI.
 *
 * Requires an authenticated user — TOTP enrollment always adds a second
 * factor to an existing account.  The userId is taken from the current
 * session identity.
 */
async function handleSetup(
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  params: Record<string, any>,
): Promise<{
  kind: "totpSetup";
  uri: string;
  secret: string;
  verifier: string;
  totpId: string;
}> {
  // TOTP enrollment requires an authenticated user
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throwAuthError("TOTP_AUTH_REQUIRED");
  }
  const [userId] = identity.subject.split("|");

  // Generate a 20-byte random secret (160 bits, per RFC 4226 recommendation)
  const secret = new Uint8Array(20);
  crypto.getRandomValues(secret);

  // Resolve the account name for the otpauth:// URI
  let accountName: string = params.accountName as string;
  if (!accountName) {
    const user = await queryUserById(ctx, userId!);
    accountName = user?.email ?? "user";
  }

  // Build the otpauth:// URI for QR code scanning
  const uri = createTOTPKeyURI(
    provider.options.issuer,
    accountName,
    secret,
    provider.options.period,
    provider.options.digits,
  );

  // Encode the secret as base-32 for manual entry
  const base32Secret = encodeBase32LowerCaseNoPadding(secret);

  // Store enrolment metadata in a verifier so we can correlate the confirm step
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

  // Insert an UNVERIFIED TOTP record in the DB
  const totpId = await mutateTotpInsert(ctx, {
    userId: userId!,
    secret: secret.buffer.slice(
      secret.byteOffset,
      secret.byteOffset + secret.byteLength,
    ),
    digits: provider.options.digits,
    period: provider.options.period,
    verified: false,
    name: params.name,
    createdAt: Date.now(),
  });

  return {
    kind: "totpSetup" as const,
    uri,
    secret: base32Secret,
    verifier,
    totpId,
  };
}

// ============================================================================
// Confirm flow
// ============================================================================

/**
 * Phase 2: Verify the first code from the authenticator app.
 *
 * Requires an authenticated user.  Marks the TOTP enrollment as verified
 * after confirming the code is correct.
 */
async function handleConfirm(
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  params: Record<string, any>,
  verifierValue: string | undefined,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  // TOTP confirmation requires an authenticated user
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throwAuthError("TOTP_AUTH_REQUIRED");
  }
  const [userId] = identity.subject.split("|");

  if (!verifierValue) {
    throwAuthError("TOTP_MISSING_VERIFIER");
  }
  if (!params.code) {
    throwAuthError("TOTP_MISSING_CODE");
  }
  if (!params.totpId) {
    throwAuthError("TOTP_MISSING_ID");
  }

  // Look up the TOTP record
  const totpDoc = await queryTotpById(ctx, params.totpId);
  if (!totpDoc) {
    throwAuthError("TOTP_NOT_FOUND");
  }
  if (totpDoc.verified) {
    throwAuthError("TOTP_ALREADY_VERIFIED");
  }

  // Extract the secret from the TOTP record
  const secret = new Uint8Array(totpDoc.secret);

  // Verify the code with a 30-second grace period
  const valid = verifyTOTPWithGracePeriod(
    secret,
    provider.options.period,
    provider.options.digits,
    params.code,
    30,
  );
  if (!valid) {
    throwAuthError("TOTP_INVALID_CODE");
  }

  // Mark the enrollment as verified
  await mutateTotpMarkVerified(ctx, params.totpId, Date.now());

  // Clean up the verifier
  await mutateVerifierDelete(ctx, verifierValue);

  // Return tokens for the existing session
  const signInResult = await callSignIn(ctx, {
    userId: userId!,
    generateTokens: true,
  });

  return { kind: "signedIn", signedIn: signInResult };
}

// ============================================================================
// Verify flow (2FA during sign-in)
// ============================================================================

/**
 * Phase 3: Verify a TOTP code during sign-in.
 *
 * Does NOT require an authenticated user — this runs mid-sign-in as a
 * second-factor challenge.  The userId is retrieved from the stored verifier.
 */
async function handleVerify(
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  params: Record<string, any>,
  verifierValue: string | undefined,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  if (!verifierValue) {
    throwAuthError("TOTP_MISSING_VERIFIER");
  }
  if (!params.code) {
    throwAuthError("TOTP_MISSING_CODE");
  }

  // Look up the verifier to retrieve the stored userId
  const verifierDoc = await queryVerifierById(ctx, verifierValue);
  if (!verifierDoc) {
    throwAuthError("TOTP_INVALID_VERIFIER");
  }

  // Parse the signature to extract userId
  const signatureData = JSON.parse(verifierDoc.signature!);
  const userId = signatureData.userId as string;

  // Look up the user's verified TOTP enrollment
  const totpDoc = await queryTotpVerifiedByUserId(ctx, userId);
  if (!totpDoc) {
    throwAuthError("TOTP_NO_ENROLLMENT");
  }

  // Extract the secret from the TOTP record
  const secret = new Uint8Array(totpDoc.secret);

  // Verify the code with a 30-second grace period
  const valid = verifyTOTPWithGracePeriod(
    secret,
    totpDoc.period,
    totpDoc.digits,
    params.code,
    30,
  );
  if (!valid) {
    throwAuthError("TOTP_INVALID_CODE");
  }

  // Update last used timestamp
  await mutateTotpUpdateLastUsed(ctx, totpDoc._id, Date.now());

  // Clean up the verifier
  await mutateVerifierDelete(ctx, verifierValue);

  // Sign in the user with tokens
  const signInResult = await callSignIn(ctx, {
    userId,
    generateTokens: true,
  });

  return { kind: "signedIn", signedIn: signInResult };
}

// ============================================================================
// Main dispatch
// ============================================================================

/**
 * Main TOTP handler dispatched from signIn.ts.
 *
 * Routes to the appropriate phase based on `params.flow`.
 */
export async function handleTotp(
  ctx: EnrichedActionCtx,
  provider: TotpProviderConfig,
  args: {
    params?: Record<string, any>;
    verifier?: string;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | {
      kind: "totpSetup";
      uri: string;
      secret: string;
      verifier: string;
      totpId: string;
    }
> {
  const flow = args.params?.flow;
  if (!flow) {
    throwAuthError(
      "TOTP_MISSING_FLOW",
      "Missing `flow` parameter. Expected one of: setup, confirm, verify",
    );
  }

  switch (flow) {
    case "setup":
      return handleSetup(ctx, provider, args.params ?? {});
    case "confirm":
      return handleConfirm(
        ctx,
        provider,
        args.params ?? {},
        args.verifier,
      );
    case "verify":
      return handleVerify(
        ctx,
        provider,
        args.params ?? {},
        args.verifier,
      );
    default:
      throwAuthError(
        "TOTP_UNKNOWN_FLOW",
        `Unknown TOTP flow: ${flow}. Expected one of: setup, confirm, verify`,
      );
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a user has a verified TOTP enrollment.
 * Called after credentials sign-in to determine if 2FA is needed.
 */
export async function checkTotpRequired(
  ctx: EnrichedActionCtx,
  userId: string,
): Promise<boolean> {
  const totpDoc = await queryTotpVerifiedByUserId(ctx, userId);
  return totpDoc !== null;
}
