/**
 * Server-side device authorization flow logic (RFC 8628).
 */

import { ConvexError } from "convex/values";
import { Effect, Match } from "effect";

import { AuthFlowError, authFlowError } from "../shared/errors";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { userIdFromIdentitySubject } from "./identity";
import { callSignIn } from "./mutations/index";
import type { DeviceProviderConfig, GenericActionCtxWithAuthConfig } from "./types";
import {
  type AuthDataModel,
  type SessionInfo,
  mutateDeviceAuthorize,
  mutateDeviceDelete,
  mutateDeviceInsert,
  mutateDeviceUpdateLastPolled,
  queryDeviceByCodeHash,
  queryDeviceByUserCode,
} from "./types";
import { generateRandomString, sha256 } from "./random";
import { requireEnv } from "./env";

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

const DEVICE_CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEVICE_CODE_LENGTH = 40;
const DEVICE_FLOWS = ["create", "poll", "verify"] as const;

type DeviceFlow = (typeof DEVICE_FLOWS)[number];

type DeviceParams = {
  flow?: string;
  deviceCode?: string;
  userCode?: string;
};

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

const deviceError = authFlowError;

const assertFlow = (flow: string): DeviceFlow => {
  if (DEVICE_FLOWS.includes(flow as DeviceFlow)) {
    return flow as DeviceFlow;
  }
  throw deviceError(
    "DEVICE_MISSING_FLOW",
    "Missing `flow` parameter. Expected one of: create, poll, verify",
  );
};

/** @internal */
export const handleDevice = (
  ctx: EnrichedActionCtx,
  provider: DeviceProviderConfig,
  args: { params?: DeviceParams },
): Effect.Effect<DeviceResult, ConvexError<AuthErrorData>> =>
  Effect.tryPromise({
    try: async () => {
      const params = args.params ?? {};
      const flow = assertFlow(typeof params.flow === "string" ? params.flow : "create");

      return await Match.value(flow).pipe(
        Match.when("create", async () => {
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
          const userCode = rawUserCode.slice(0, mid) + "-" + rawUserCode.slice(mid);

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
            verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(userCode)}`,
            expiresIn: provider.expiresIn,
            interval: provider.interval,
          };
        }),
        Match.when("poll", async () => {
          if (typeof params.deviceCode !== "string") {
            throw deviceError(
              "DEVICE_MISSING_FLOW",
              "Missing `deviceCode` parameter for poll flow.",
            );
          }

          const hash = await sha256(params.deviceCode);
          const doc = await queryDeviceByCodeHash(ctx, hash);
          if (doc === null) {
            throw deviceError(
              "DEVICE_CODE_EXPIRED",
              "The device code has expired. Please start a new authorization request.",
            );
          }
          if (Date.now() > doc.expiresAt) {
            await mutateDeviceDelete(ctx, doc._id);
            throw deviceError(
              "DEVICE_CODE_EXPIRED",
              "The device code has expired. Please start a new authorization request.",
            );
          }
          if (
            doc.lastPolledAt !== undefined &&
            (Date.now() - doc.lastPolledAt) / 1000 < doc.interval
          ) {
            throw deviceError(
              "DEVICE_SLOW_DOWN",
              "Polling too frequently. Increase the interval between requests.",
            );
          }

          await mutateDeviceUpdateLastPolled(ctx, doc._id, Date.now());

          if (doc.status === "pending") {
            throw deviceError(
              "DEVICE_AUTHORIZATION_PENDING",
              "The user has not yet authorized this device.",
            );
          }
          if (doc.status === "denied") {
            await mutateDeviceDelete(ctx, doc._id);
            throw deviceError(
              "DEVICE_CODE_DENIED",
              "The authorization request was denied.",
            );
          }
          if (!doc.userId || !doc.sessionId) {
            throw deviceError(
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
        }),
        Match.when("verify", async () => {
          if (typeof params.userCode !== "string") {
            throw deviceError(
              "DEVICE_INVALID_USER_CODE",
              "Missing `userCode` parameter for verify flow.",
            );
          }

          const identity = await ctx.auth.getUserIdentity();
          if (identity === null) {
            throw deviceError(
              "NOT_SIGNED_IN",
              "You must be signed in to authorize a device.",
            );
          }

          const userId = userIdFromIdentitySubject(identity.subject);
          const doc = await queryDeviceByUserCode(ctx, params.userCode);
          if (doc === null) {
            throw deviceError(
              "DEVICE_INVALID_USER_CODE",
              "Invalid or expired user code.",
            );
          }
          if (Date.now() > doc.expiresAt) {
            await mutateDeviceDelete(ctx, doc._id);
            throw deviceError(
              "DEVICE_CODE_EXPIRED",
              "The device code has expired. Please start a new authorization request.",
            );
          }
          if (doc.status !== "pending") {
            throw deviceError(
              "DEVICE_ALREADY_AUTHORIZED",
              "This device code has already been authorized.",
            );
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
        }),
        Match.exhaustive,
      );
    },
    catch: (error) =>
      error instanceof ConvexError
        ? error
        : error instanceof AuthFlowError
          ? toConvexError(error)
          : error instanceof Error
          ? toConvexError(
              authFlowError("INTERNAL_ERROR", `Device flow failed: ${error.message}`),
            )
          : toConvexError(error),
  });
