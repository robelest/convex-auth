/**
 * Server-side device authorization flow logic (RFC 8628).
 *
 * Handles the three phases of the device flow:
 * 1. (default) — Generate a device code + user code pair
 * 2. poll      — Device checks whether the user has authorized yet
 * 3. verify    — Authenticated user links a user code to their session
 *
 * Uses `@oslojs/crypto/random` for code generation and
 * `@oslojs/crypto/sha2` for hashing device codes before storage.
 */

import {
  DeviceProviderConfig,
  GenericActionCtxWithAuthConfig,
} from "../types";
import {
  AuthDataModel,
  SessionInfo,
  mutateDeviceInsert,
  queryDeviceByCodeHash,
  queryDeviceByUserCode,
  mutateDeviceAuthorize,
  mutateDeviceUpdateLastPolled,
  mutateDeviceDelete,
} from "./types";
import { callSignIn } from "./mutations/index";
import { generateRandomString, sha256 } from "./utils";
import { throwAuthError } from "../errors";
import { requireEnv } from "../utils";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

// ============================================================================
// Constants
// ============================================================================

/** High-entropy device code alphabet (alphanumeric). */
const DEVICE_CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Device code length (40 chars ≈ 238 bits of entropy). */
const DEVICE_CODE_LENGTH = 40;

// ============================================================================
// Create flow (default — no flow param)
// ============================================================================

/**
 * Phase 1: Generate a device code + user code pair.
 *
 * Called by the input-constrained device. Returns the codes and
 * verification URIs so the device can display them to the user.
 */
async function handleCreate(
  ctx: EnrichedActionCtx,
  provider: DeviceProviderConfig,
): Promise<{
  kind: "deviceCode";
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}> {
  // Generate the raw device code (high entropy, never stored raw)
  const deviceCode = generateRandomString(
    DEVICE_CODE_LENGTH,
    DEVICE_CODE_ALPHABET,
  );
  const deviceCodeHash = await sha256(deviceCode);

  // Generate the user code (short, no vowels per RFC 8628 §6.1)
  const rawUserCode = generateRandomString(
    provider.userCodeLength,
    provider.charset,
  );
  // Format as XXXX-XXXX for display
  const mid = Math.floor(rawUserCode.length / 2);
  const userCode = rawUserCode.slice(0, mid) + "-" + rawUserCode.slice(mid);

  const expiresAt = Date.now() + provider.expiresIn * 1000;

  // Store in the component DB
  await mutateDeviceInsert(ctx, {
    deviceCodeHash,
    userCode,
    expiresAt,
    interval: provider.interval,
    status: "pending",
  });

  // Build verification URIs
  // Prefer explicit config; fall back to SITE_URL (Convex HTTP actions URL).
  const verificationUri =
    provider.verificationUri ??
    `${process.env.SITE_URL ?? requireEnv("SITE_URL")}/device`;
  // Use `user_code` param to avoid collision with OAuth `?code=` on SSR frameworks.
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

  return {
    kind: "deviceCode",
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn: provider.expiresIn,
    interval: provider.interval,
  };
}

// ============================================================================
// Poll flow
// ============================================================================

/**
 * Phase 2: Device polls for authorization status.
 *
 * Returns tokens when authorized, or throws a structured error
 * for pending / slow_down / expired / denied states.
 */
async function handlePoll(
  ctx: EnrichedActionCtx,
  _provider: DeviceProviderConfig,
  params: Record<string, any>,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  const rawDeviceCode = params.deviceCode as string | undefined;
  if (!rawDeviceCode) {
    throwAuthError("DEVICE_MISSING_FLOW", "Missing `deviceCode` parameter for poll flow.");
  }

  const deviceCodeHash = await sha256(rawDeviceCode);
  const doc = await queryDeviceByCodeHash(ctx, deviceCodeHash);

  // Unknown or already-consumed code
  if (!doc) {
    throwAuthError("DEVICE_CODE_EXPIRED");
  }

  // Check expiry
  if (Date.now() > doc.expiresAt) {
    // Lazy cleanup
    await mutateDeviceDelete(ctx, doc._id);
    throwAuthError("DEVICE_CODE_EXPIRED");
  }

  // Enforce polling interval (slow_down)
  if (doc.lastPolledAt !== undefined) {
    const elapsed = (Date.now() - doc.lastPolledAt) / 1000;
    if (elapsed < doc.interval) {
      throwAuthError("DEVICE_SLOW_DOWN");
    }
  }

  // Update last polled timestamp
  await mutateDeviceUpdateLastPolled(ctx, doc._id, Date.now());

  // Check status
  switch (doc.status) {
    case "pending":
      throwAuthError("DEVICE_AUTHORIZATION_PENDING");
      break; // unreachable but satisfies control flow

    case "denied":
      await mutateDeviceDelete(ctx, doc._id);
      throwAuthError("DEVICE_CODE_DENIED");
      break;

    case "authorized": {
      // Device is authorized — issue tokens for the linked user/session
      if (!doc.userId || !doc.sessionId) {
        throwAuthError("INTERNAL_ERROR", "Authorized device code missing userId or sessionId.");
      }

      // Clean up the device code record
      await mutateDeviceDelete(ctx, doc._id);

      // Generate tokens for the authorized session
      const signInResult = await callSignIn(ctx, {
        userId: doc.userId,
        sessionId: doc.sessionId,
        generateTokens: true,
      });

      return { kind: "signedIn", signedIn: signInResult };
    }

    default: {
      const _exhaustive: never = doc.status;
      throwAuthError("INTERNAL_ERROR", `Unknown device status: ${doc.status}`);
    }
  }
}

// ============================================================================
// Verify flow
// ============================================================================

/**
 * Phase 3: Authenticated user authorizes a device code.
 *
 * The user enters the user code on a verification page while signed in.
 * This links the device code to the user's identity so the device can
 * obtain tokens on the next poll.
 */
async function handleVerify(
  ctx: EnrichedActionCtx,
  _provider: DeviceProviderConfig,
  params: Record<string, any>,
): Promise<{ kind: "signedIn"; signedIn: SessionInfo | null }> {
  const userCode = params.userCode as string | undefined;
  if (!userCode) {
    throwAuthError("DEVICE_INVALID_USER_CODE", "Missing `userCode` parameter for verify flow.");
  }

  // Require an authenticated user
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throwAuthError("NOT_SIGNED_IN", "You must be signed in to authorize a device.");
  }
  const [userId] = identity.subject.split("|");

  // Look up the pending device code by user code
  const doc = await queryDeviceByUserCode(ctx, userCode);
  if (!doc) {
    throwAuthError("DEVICE_INVALID_USER_CODE");
  }

  // Check expiry
  if (Date.now() > doc.expiresAt) {
    await mutateDeviceDelete(ctx, doc._id);
    throwAuthError("DEVICE_CODE_EXPIRED");
  }

  // Already authorized (shouldn't happen with the index filter, but be safe)
  if (doc.status !== "pending") {
    throwAuthError("DEVICE_ALREADY_AUTHORIZED");
  }

  // Create a new session for the device
  const signInResult = await callSignIn(ctx, {
    userId: userId!,
    generateTokens: false, // Device gets tokens via poll, not here
  });

  // Authorize the device code with the new session
  await mutateDeviceAuthorize(
    ctx,
    doc._id,
    signInResult.userId,
    signInResult.sessionId,
  );

  // Return success (no tokens — the verification page doesn't need them)
  return { kind: "signedIn", signedIn: null };
}

// ============================================================================
// Main dispatch
// ============================================================================

/**
 * Main device authorization handler dispatched from signIn.ts.
 *
 * Routes to the appropriate phase based on `params.flow`:
 * - (no flow / default) → create device + user codes
 * - "poll" → check authorization status
 * - "verify" → user authorizes a device code
 */
export async function handleDevice(
  ctx: EnrichedActionCtx,
  provider: DeviceProviderConfig,
  args: {
    params?: Record<string, any>;
  },
): Promise<
  | {
      kind: "deviceCode";
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    }
  | { kind: "signedIn"; signedIn: SessionInfo | null }
> {
  const flow = args.params?.flow;

  // Default flow: create device + user codes
  if (!flow) {
    return handleCreate(ctx, provider);
  }

  switch (flow) {
    case "poll":
      return handlePoll(ctx, provider, args.params ?? {});
    case "verify":
      return handleVerify(ctx, provider, args.params ?? {});
    default:
      throwAuthError(
        "DEVICE_UNKNOWN_FLOW",
        `Unknown device flow: ${flow}. Expected one of: poll, verify`,
      );
  }
}
