import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import * as Provider from "../provider";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../ratelimit";
import {
  createNewAndDeleteExistingSession,
  getAuthSessionId,
  maybeGenerateTokensForSession,
} from "../sessions";
import {
  createSyntheticOAuthMaterializedConfig,
  isEnterpriseProviderId,
} from "../sso";
import { MutationCtx, SessionInfo } from "../types";
import { upsertUserAndAccount } from "../users";
import { LOG_LEVELS, logWithLevel, sha256 } from "../utils";
import { requireEnv } from "../utils";
import { AUTH_STORE_REF } from "./store";

export const verifyCodeAndSignInArgs = v.object({
  params: v.any(),
  provider: v.optional(v.string()),
  verifier: v.optional(v.string()),
  generateTokens: v.boolean(),
  allowExtraProviders: v.boolean(),
});

type ReturnType = null | SessionInfo;

// ============================================================================
// Small validators for the verification pipeline
// ============================================================================

/** A soft verification failure — logged and collapsed to null at the boundary. */
class VerifyFailure {
  readonly _tag = "VerifyFailure" as const;
  constructor(readonly reason: string) {}
}

// ============================================================================
// Main exported function
// ============================================================================

export async function verifyCodeAndSignInImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifyCodeAndSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  logWithLevel(LOG_LEVELS.DEBUG, "verifyCodeAndSignInImpl args:", {
    params: { email: args.params.email, phone: args.params.phone },
    provider: args.provider,
    verifier: args.verifier,
    generateTokens: args.generateTokens,
    allowExtraProviders: args.allowExtraProviders,
  });

  const { generateTokens, provider, allowExtraProviders } = args;
  if (generateTokens) {
    requireEnv("JWT_PRIVATE_KEY");
    requireEnv("JWKS");
    requireEnv("CONVEX_SITE_URL");
  }
  const identifier: string | undefined = args.params.email ?? args.params.phone;

  try {
    if (identifier !== undefined) {
      const limited = await Fx.run(
        isSignInRateLimited(ctx, identifier, config),
      );
      if (limited) {
        throw new VerifyFailure(
          "Too many failed attempts to verify code for this email",
        );
      }
    }

    const db = authDb(ctx, config);
    const { params, verifier } = args;
    const hash = await sha256(params.code);
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

    const codeProvider = isEnterpriseProviderId(code.provider)
      ? createSyntheticOAuthMaterializedConfig(code.provider)
      : getProviderOrThrow(code.provider, allowExtraProviders);

    if (
      codeProvider !== null &&
      (codeProvider.type === "email" || codeProvider.type === "phone") &&
      codeProvider.authorize !== undefined
    ) {
      await codeProvider.authorize(args.params, account);
    }

    const methodProvider = isEnterpriseProviderId(account.provider)
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
      await Fx.run(resetSignInRateLimit(ctx, identifier, config));
    }

    const sessionId = await createNewAndDeleteExistingSession(
      ctx,
      config,
      userId,
    );
    return await maybeGenerateTokensForSession(
      ctx,
      config,
      userId,
      sessionId,
      generateTokens,
    );
  } catch (error) {
    if (error instanceof VerifyFailure) {
      logWithLevel(LOG_LEVELS.ERROR, error.reason);
      if (identifier !== undefined) {
        await Fx.run(recordFailedSignIn(ctx, identifier, config));
      }
      return null;
    }
    logWithLevel(
      LOG_LEVELS.ERROR,
      `verifyCodeAndSignInImpl failed: ${String(error)}`,
    );
    return null;
  }
}

// ============================================================================
// Action-level caller (unchanged — just forwards to mutation)
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
  });
};
