import { Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import * as Provider from "../provider.js";
import { OAuthConfig } from "@auth/core/providers/oauth.js";
import { upsertUserAndAccount } from "../users.js";
import { generateRandomString, logWithLevel, sha256 } from "../utils.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./store.js";
import { throwAuthError } from "../../errors.js";

const OAUTH_SIGN_IN_EXPIRATION_MS = 1000 * 60 * 2; // 2 minutes

export const userOAuthArgs = v.object({
  provider: v.string(),
  providerAccountId: v.string(),
  profile: v.any(),
  signature: v.string(),
});

type ReturnType = string;

export async function userOAuthImpl(
  ctx: MutationCtx,
  args: Infer<typeof userOAuthArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  logWithLevel("DEBUG", "userOAuthImpl args:", args);
  const { profile, provider, providerAccountId, signature } = args;
  const db = authDb(ctx, config);
  const providerConfig = getProviderOrThrow(provider) as OAuthConfig<any>;
  const existingAccount = await db.accounts.get(provider, providerAccountId);

  const verifier = await db.verifiers.getBySignature(signature);
  if (verifier === null) {
    throwAuthError("OAUTH_INVALID_STATE");
  }

  const { accountId } = await upsertUserAndAccount(
    ctx,
    verifier.sessionId ?? null,
    existingAccount !== null ? { existingAccount } : { providerAccountId },
    { type: "oauth", provider: providerConfig, profile },
    config,
  );

  const code = generateRandomString(8, "0123456789");
  await db.verifiers.delete(verifier._id);
  const existingVerificationCode = await db.verificationCodes.getByAccountId(accountId);
  if (existingVerificationCode !== null) {
    await db.verificationCodes.delete(existingVerificationCode._id);
  }
  await db.verificationCodes.create({
      code: await sha256(code),
      accountId,
      provider,
      expirationTime: Date.now() + OAUTH_SIGN_IN_EXPIRATION_MS,
      verifier: verifier._id,
    });
  return code;
}

export const callUserOAuth = async (
  ctx: ActionCtx,
  args: Infer<typeof userOAuthArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "userOAuth",
      ...args,
    },
  });
};
