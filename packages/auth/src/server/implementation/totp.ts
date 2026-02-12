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

import { GenericId } from "convex/values";
import {
  generateTOTP,
  verifyTOTPWithGracePeriod,
  createTOTPKeyURI,
} from "@oslojs/otp";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import {
  TotpProviderConfig,
  GenericActionCtxWithAuthConfig,
} from "../types.js";
import { AuthDataModel, SessionInfo } from "./types.js";
import { callSignIn, callVerifier } from "./mutations/index.js";
import { callVerifierSignature } from "./mutations/verifierSignature.js";

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
    throw new Error(
      "TOTP enrollment requires an authenticated user. " +
        "Sign in first, then add TOTP to your account.",
    );
  }
  const [userId] = identity.subject.split("|");

  // Generate a 20-byte random secret (160 bits, per RFC 4226 recommendation)
  const secret = new Uint8Array(20);
  crypto.getRandomValues(secret);

  // Resolve the account name for the otpauth:// URI
  let accountName: string = params.accountName as string;
  if (!accountName) {
    const user = await ctx.runQuery(
      ctx.auth.config.component.public.userGetById,
      { userId: userId! },
    );
    accountName = (user as any)?.email ?? "user";
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
  const totpId = await ctx.runMutation(
    ctx.auth.config.component.public.totpInsert,
    {
      userId: userId as any,
      secret: secret.buffer.slice(
        secret.byteOffset,
        secret.byteOffset + secret.byteLength,
      ),
      digits: provider.options.digits,
      period: provider.options.period,
      verified: false,
      name: params.name,
      createdAt: Date.now(),
    },
  );

  return {
    kind: "totpSetup" as const,
    uri,
    secret: base32Secret,
    verifier,
    totpId: totpId as string,
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
    throw new Error(
      "TOTP confirmation requires an authenticated user. " +
        "Sign in first, then confirm your TOTP enrollment.",
    );
  }
  const [userId] = identity.subject.split("|");

  if (!verifierValue) {
    throw new Error("Missing verifier");
  }
  if (!params.code) {
    throw new Error("Missing `code` parameter");
  }
  if (!params.totpId) {
    throw new Error("Missing `totpId` parameter");
  }

  // Look up the TOTP record
  const totpDoc = await ctx.runQuery(
    ctx.auth.config.component.public.totpGetById,
    { totpId: params.totpId },
  );
  if (!totpDoc) {
    throw new Error("TOTP enrollment not found");
  }
  if ((totpDoc as any).verified) {
    throw new Error("TOTP enrollment is already verified");
  }

  // Extract the secret from the TOTP record
  const secret = new Uint8Array((totpDoc as any).secret);

  // Verify the code with a 30-second grace period
  const valid = verifyTOTPWithGracePeriod(
    secret,
    provider.options.period,
    provider.options.digits,
    params.code,
    30,
  );
  if (!valid) {
    throw new Error("Invalid TOTP code");
  }

  // Mark the enrollment as verified
  await ctx.runMutation(
    ctx.auth.config.component.public.totpMarkVerified,
    { totpId: params.totpId as any, lastUsedAt: Date.now() },
  );

  // Clean up the verifier
  await ctx.runMutation(
    ctx.auth.config.component.public.verifierDelete,
    { verifierId: verifierValue },
  );

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
    throw new Error("Missing verifier");
  }
  if (!params.code) {
    throw new Error("Missing `code` parameter");
  }

  // Look up the verifier to retrieve the stored userId
  const verifierDoc = await ctx.runQuery(
    ctx.auth.config.component.public.verifierGetById,
    { verifierId: verifierValue },
  );
  if (!verifierDoc) {
    throw new Error("Invalid or expired verifier");
  }

  // Parse the signature to extract userId
  const signatureData = JSON.parse((verifierDoc as any).signature);
  const userId = signatureData.userId as string;

  // Look up the user's verified TOTP enrollment
  const totpDoc = await ctx.runQuery(
    ctx.auth.config.component.public.totpGetVerifiedByUserId,
    { userId: userId as any },
  );
  if (!totpDoc) {
    throw new Error("No TOTP enrollment found");
  }

  // Extract the secret from the TOTP record
  const secret = new Uint8Array((totpDoc as any).secret);

  // Verify the code with a 30-second grace period
  const valid = verifyTOTPWithGracePeriod(
    secret,
    (totpDoc as any).period,
    (totpDoc as any).digits,
    params.code,
    30,
  );
  if (!valid) {
    throw new Error("Invalid TOTP code");
  }

  // Update last used timestamp
  await ctx.runMutation(
    ctx.auth.config.component.public.totpUpdateLastUsed,
    { totpId: (totpDoc as any)._id, lastUsedAt: Date.now() },
  );

  // Clean up the verifier
  await ctx.runMutation(
    ctx.auth.config.component.public.verifierDelete,
    { verifierId: verifierValue },
  );

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
    throw new Error(
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
      throw new Error(
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
  const totpDoc = await ctx.runQuery(
    ctx.auth.config.component.public.totpGetVerifiedByUserId,
    { userId: userId as any },
  );
  return totpDoc !== null;
}
