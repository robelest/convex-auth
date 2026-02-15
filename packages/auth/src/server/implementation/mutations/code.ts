import { GenericId, Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types";
import * as Provider from "../provider";
import { EmailConfig, PhoneConfig } from "../../types";
import { getAccountOrThrow, upsertUserAndAccount } from "../users";
import { getAuthSessionId } from "../sessions";
import { LOG_LEVELS, logWithLevel, sha256 } from "../utils";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";

export const createVerificationCodeArgs = v.object({
  accountId: v.optional(v.string()),
  provider: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  code: v.string(),
  expirationTime: v.number(),
  allowExtraProviders: v.boolean(),
});

type ReturnType = string;

export async function createVerificationCodeImpl(
  ctx: MutationCtx,
  args: Infer<typeof createVerificationCodeArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  logWithLevel(LOG_LEVELS.DEBUG, "createVerificationCodeImpl args:", args);
  const {
    email,
    phone,
    code,
    expirationTime,
    provider: providerId,
    accountId: existingAccountId,
    allowExtraProviders,
  } = args;
  const db = authDb(ctx, config);
  const typedExistingAccountId = existingAccountId as
    | GenericId<"account">
    | undefined;
  const existingAccount =
    typedExistingAccountId !== undefined
      ? await getAccountOrThrow(ctx, typedExistingAccountId, config)
      : await db.accounts.get(providerId, email ?? phone!);

  const provider = getProviderOrThrow(providerId, allowExtraProviders) as
    | EmailConfig
    | PhoneConfig;
  const { accountId } = await upsertUserAndAccount(
    ctx,
    await getAuthSessionId(ctx),
    existingAccount !== null
      ? { existingAccount }
      : { providerAccountId: email ?? phone! },
    provider.type === "email"
      ? { type: "email", provider, profile: { email: email! } }
      : { type: "phone", provider, profile: { phone: phone! } },
    config,
  );
  await generateUniqueVerificationCode(
    ctx,
    accountId,
    providerId,
    code,
    expirationTime,
    { email, phone },
    config,
  );
  return email ?? phone!;
}

export const callCreateVerificationCode = async (
  ctx: ActionCtx,
  args: Infer<typeof createVerificationCodeArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "createVerificationCode",
      ...args,
    },
  });
};

async function generateUniqueVerificationCode(
  ctx: MutationCtx,
  accountId: GenericId<"account">,
  provider: string,
  code: string,
  expirationTime: number,
  { email, phone }: { email?: string; phone?: string },
  config: Provider.Config,
) {
  const db = authDb(ctx, config);
  const existingCode = await db.verificationCodes.getByAccountId(accountId);
  if (existingCode !== null) {
    await db.verificationCodes.delete(existingCode._id);
  }
  await db.verificationCodes.create({
    accountId,
    provider,
    code: await sha256(code),
    expirationTime,
    emailVerified: email,
    phoneVerified: phone,
  });
}
