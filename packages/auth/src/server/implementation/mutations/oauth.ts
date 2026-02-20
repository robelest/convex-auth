import { Infer, v } from "convex/values";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { MutationCtx } from "../types";
import * as Provider from "../provider";
import type { AuthProviderMaterializedConfig } from "../../types";
import { upsertUserAndAccount } from "../users";
import { generateRandomString, logWithLevel, sha256 } from "../utils";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";
import { throwAuthError } from "../../errors";

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
  const providerConfig = getProviderOrThrow(provider) as AuthProviderMaterializedConfig;
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

export const callUserOAuth = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof userOAuthArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "userOAuth",
      ...args,
    },
  });
};
