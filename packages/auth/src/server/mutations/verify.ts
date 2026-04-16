import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { requireEnv } from "../env";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../limits";
import { LOG_LEVELS, log } from "../log";
import type { SignInParams } from "../payloads";
import { payloadRecordValidator } from "../payloads";
import { sha256 } from "../random";
import { getAuthSessionId, issueSession } from "../sessions";
import { createSyntheticOAuthMaterializedConfig } from "../sso/oidc";
import { isGroupProviderId } from "../sso/shared";
import { MutationCtx, SessionInfo } from "../types";
import { upsertUserAndAccount } from "../users";
import { AUTH_STORE_REF } from "./store/refs";

export const verifyCodeAndSignInArgs = v.object({
  params: payloadRecordValidator,
  provider: v.optional(v.string()),
  verifier: v.optional(v.string()),
  generateTokens: v.boolean(),
  allowExtraProviders: v.boolean(),
});

type ReturnType = null | SessionInfo;

// ============================================================================
// Main exported function
// ============================================================================

export async function verifyCodeAndSignInImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifyCodeAndSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const params = args.params as SignInParams;
  const { generateTokens, provider, allowExtraProviders } = args;
  const identifier: string | undefined =
    typeof params.email === "string"
      ? params.email
      : typeof params.phone === "string"
        ? params.phone
        : undefined;

  try {
    log(LOG_LEVELS.DEBUG, "verifyCodeAndSignInImpl args:", {
      params: { email: params.email, phone: params.phone },
      provider: args.provider,
      verifier: args.verifier,
      generateTokens: args.generateTokens,
      allowExtraProviders: args.allowExtraProviders,
    });
    if (generateTokens) {
      requireEnv("JWT_PRIVATE_KEY");
      requireEnv("JWKS");
      requireEnv("CONVEX_SITE_URL");
    }

    if (identifier !== undefined) {
      const limited = await isSignInRateLimited(ctx, identifier, config);
      if (limited) {
        throw new VerifyFailure(
          "Too many failed attempts to verify code for this email",
        );
      }
    }

    const db = authDb(ctx, config);
    const verifier = args.verifier;
    const codeValue = params.code;
    if (typeof codeValue !== "string") {
      throw new VerifyFailure("Invalid verification code");
    }
    const hash = await sha256(codeValue);
    const code = await db.verificationCodes.getByCode(hash);
    if (code === null) {
      throw new VerifyFailure("Invalid verification code");
    }

    await db.verificationCodes.delete(code._id);

    if (code.verifier !== verifier) {
      throw new VerifyFailure("Invalid verifier");
    }
    if (code.expirationTime < Date.now()) {
      throw new VerifyFailure("Expired verification code");
    }
    if (provider !== undefined && code.provider !== provider) {
      throw new VerifyFailure(
        `Invalid provider "${provider}" for given \`code\``,
      );
    }

    const account = await db.accounts.getById(code.accountId);
    if (account === null) {
      throw new VerifyFailure(
        "Account associated with this email has been deleted",
      );
    }

    const codeProvider = isGroupProviderId(code.provider)
      ? createSyntheticOAuthMaterializedConfig(code.provider)
      : getProviderOrThrow(code.provider, allowExtraProviders);

    if (
      codeProvider !== null &&
      (codeProvider.type === "email" || codeProvider.type === "phone") &&
      codeProvider.authorize !== undefined
    ) {
      await codeProvider.authorize(params, account);
    }

    const methodProvider = isGroupProviderId(account.provider)
      ? createSyntheticOAuthMaterializedConfig(account.provider)
      : getProviderOrThrow(account.provider);

    const userId =
      methodProvider.type === "oauth"
        ? account.userId
        : (
            await upsertUserAndAccount(
              ctx,
              await getAuthSessionId(ctx),
              { existingAccount: account },
              {
                type: "verification",
                provider: methodProvider,
                profile: {
                  ...(code.emailVerified !== undefined
                    ? { email: code.emailVerified, emailVerified: true }
                    : {}),
                  ...(code.phoneVerified !== undefined
                    ? { phone: code.phoneVerified, phoneVerified: true }
                    : {}),
                },
              },
              config,
            )
          ).userId;

    if (identifier !== undefined) {
      await resetSignInRateLimit(ctx, identifier, config);
    }

    const replaceSessionId = await getAuthSessionId(ctx);
    return await issueSession(ctx, config, {
      userId,
      replaceSessionId: replaceSessionId ?? undefined,
      generateTokens,
    });
  } catch (error) {
    if (error instanceof VerifyFailure) {
      log(LOG_LEVELS.ERROR, error.reason);
      if (identifier !== undefined) {
        await recordFailedSignIn(ctx, identifier, config);
      }
      return null;
    }
    throw error;
  }
}

/** A soft verification failure -- logged and collapsed to null at the boundary. */
class VerifyFailure extends Error {
  readonly _tag = "VerifyFailure";
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "VerifyFailure";
  }
}

// ============================================================================
// Action-level caller (unchanged -- just forwards to mutation)
// ============================================================================

export const callVerifyCodeAndSignIn = async <
  DataModel extends GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof verifyCodeAndSignInArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifyCodeAndSignIn",
      ...args,
    },
  }) as Promise<ReturnType>;
};
