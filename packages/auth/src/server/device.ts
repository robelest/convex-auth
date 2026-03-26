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

import { Fx } from "@robelest/fx";

import { AuthError } from "./authError";
import { userIdFromIdentitySubject } from "./identity";
import { callSignIn } from "./mutations/index";
import { DeviceProviderConfig, GenericActionCtxWithAuthConfig } from "./types";
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
import { generateRandomString, sha256 } from "./utils";
import { requireEnv } from "./utils";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

// ============================================================================
// Constants
// ============================================================================

const DEVICE_CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEVICE_CODE_LENGTH = 40;
const DEVICE_FLOWS = ["create", "poll", "verify"] as const;

// ============================================================================
// Create flow
// ============================================================================

// ============================================================================
// Poll flow — pipeline of validations + status dispatch
// ============================================================================

// ============================================================================
// Main dispatch
// ============================================================================

type DeviceResult =
  | {
      kind: "deviceCode";
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    }
  | { kind: "signedIn"; signedIn: SessionInfo | null };

/** @internal */
export const handleDevice = (
  ctx: EnrichedActionCtx,
  provider: DeviceProviderConfig,
  args: { params?: Record<string, any> },
): Fx<DeviceResult, AuthError> =>
  Fx.from({
    ok: async () => {
      const params = (args.params ?? {}) as Record<string, unknown>;
      const flow = (typeof params.flow === "string" ? params.flow : "create") as
        | "create"
        | "poll"
        | "verify";

      if (!DEVICE_FLOWS.some((candidate) => candidate === flow)) {
        throw new AuthError(
          "DEVICE_MISSING_FLOW",
          "Missing `flow` parameter. Expected one of: create, poll, verify",
        );
      }

      if (flow === "create") {
        const deviceCode = generateRandomString(
          DEVICE_CODE_LENGTH,
          DEVICE_CODE_ALPHABET,
        );
        const deviceCodeHash = await sha256(deviceCode);

        const rawUserCode = generateRandomString(
          provider.userCodeLength,
          provider.charset,
        );
        const mid = Math.floor(rawUserCode.length / 2);
        const userCode =
          rawUserCode.slice(0, mid) + "-" + rawUserCode.slice(mid);

        const expiresAt = Date.now() + provider.expiresIn * 1000;
        await mutateDeviceInsert(ctx, {
          deviceCodeHash,
          userCode,
          expiresAt,
          interval: provider.interval,
          status: "pending",
        });

        const verificationUri =
          provider.verificationUri ??
          `${process.env.SITE_URL ?? requireEnv("SITE_URL")}/device`;

        return {
          kind: "deviceCode" as const,
          deviceCode,
          userCode,
          verificationUri,
          verificationUriComplete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
          expiresIn: provider.expiresIn,
          interval: provider.interval,
        };
      }

      if (flow === "poll") {
        if (typeof params.deviceCode !== "string") {
          throw new AuthError(
            "DEVICE_MISSING_FLOW",
            "Missing `deviceCode` parameter for poll flow.",
          );
        }

        const hash = await sha256(params.deviceCode);
        const doc = await queryDeviceByCodeHash(ctx, hash);
        if (doc === null) {
          throw new AuthError("DEVICE_CODE_EXPIRED");
        }
        if (Date.now() > doc.expiresAt) {
          await mutateDeviceDelete(ctx, doc._id);
          throw new AuthError("DEVICE_CODE_EXPIRED");
        }
        if (
          doc.lastPolledAt !== undefined &&
          (Date.now() - doc.lastPolledAt) / 1000 < doc.interval
        ) {
          throw new AuthError("DEVICE_SLOW_DOWN");
        }

        await mutateDeviceUpdateLastPolled(ctx, doc._id, Date.now());

        if (doc.status === "pending") {
          throw new AuthError("DEVICE_AUTHORIZATION_PENDING");
        }
        if (doc.status === "denied") {
          await mutateDeviceDelete(ctx, doc._id);
          throw new AuthError("DEVICE_CODE_DENIED");
        }

        if (!doc.userId || !doc.sessionId) {
          throw new AuthError(
            "INTERNAL_ERROR",
            "Authorized device code missing userId or sessionId",
          );
        }

        await mutateDeviceDelete(ctx, doc._id);
        const signInResult = await callSignIn(ctx, {
          userId: doc.userId,
          sessionId: doc.sessionId,
          generateTokens: true,
        });
        return { kind: "signedIn" as const, signedIn: signInResult };
      }

      if (typeof params.userCode !== "string") {
        throw new AuthError(
          "DEVICE_INVALID_USER_CODE",
          "Missing `userCode` parameter for verify flow.",
        );
      }

      const identity = await ctx.auth.getUserIdentity();
      if (identity === null) {
        throw new AuthError(
          "NOT_SIGNED_IN",
          "You must be signed in to authorize a device.",
        );
      }

      const userId = userIdFromIdentitySubject(identity.subject);
      const doc = await queryDeviceByUserCode(ctx, params.userCode);
      if (doc === null) {
        throw new AuthError("DEVICE_INVALID_USER_CODE");
      }
      if (Date.now() > doc.expiresAt) {
        await mutateDeviceDelete(ctx, doc._id);
        throw new AuthError("DEVICE_CODE_EXPIRED");
      }
      if (doc.status !== "pending") {
        throw new AuthError("DEVICE_ALREADY_AUTHORIZED");
      }

      const signInResult = await callSignIn(ctx, {
        userId,
        generateTokens: false,
      });
      await mutateDeviceAuthorize(
        ctx,
        doc._id,
        signInResult.userId,
        signInResult.sessionId,
      );
      return { kind: "signedIn" as const, signedIn: null };
    },
    err: (e) =>
      e instanceof AuthError
        ? e
        : new AuthError("INTERNAL_ERROR", `Device flow failed: ${String(e)}`),
  });
