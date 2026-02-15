import { Infer, v } from "convex/values";
import { ActionCtx, Doc, MutationCtx } from "../types.js";
import * as Provider from "../provider.js";
import { ConvexCredentialsConfig } from "../../types.js";
import { upsertUserAndAccount } from "../users.js";
import { getAuthSessionId } from "../sessions.js";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./store.js";
import { throwAuthError } from "../../errors.js";

export const createAccountFromCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  profile: v.any(),
  shouldLinkViaEmail: v.optional(v.boolean()),
  shouldLinkViaPhone: v.optional(v.boolean()),
});

type ReturnType = { account: Doc<"account">; user: Doc<"user"> };

export async function createAccountFromCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof createAccountFromCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  logWithLevel(LOG_LEVELS.DEBUG, "createAccountFromCredentialsImpl args:", {
    provider: args.provider,
    account: {
      id: args.account.id,
      secret: maybeRedact(args.account.secret ?? ""),
    },
  });
  const {
    provider: providerId,
    account,
    profile,
    shouldLinkViaEmail,
    shouldLinkViaPhone,
  } = args;
  const db = authDb(ctx, config);
  const provider = getProviderOrThrow(providerId) as ConvexCredentialsConfig;
  const existingAccount = (await db.accounts.get(
    provider.id,
    account.id,
  )) as Doc<"account"> | null;
  if (existingAccount !== null) {
    if (
      account.secret !== undefined &&
      !(await Provider.verify(
        provider,
        account.secret,
        existingAccount.secret ?? "",
      ))
    ) {
      throwAuthError("ACCOUNT_ALREADY_EXISTS", `Account ${account.id} already exists`);
    }
    return {
      account: existingAccount,
      // TODO: Ian removed this,
      user: (await db.users.getById(existingAccount.userId)) as unknown as Doc<"user">,
    };
  }

  const secret =
    account.secret !== undefined
      ? await Provider.hash(provider, account.secret)
      : undefined;
  const { userId, accountId } = await upsertUserAndAccount(
    ctx,
    await getAuthSessionId(ctx),
    { providerAccountId: account.id, secret },
    {
      type: "credentials",
      provider,
      profile,
      shouldLinkViaEmail,
      shouldLinkViaPhone,
    },
    config,
  );

  return {
    account: (await db.accounts.getById(accountId)) as Doc<"account">,
    user: (await db.users.getById(userId)) as unknown as Doc<"user">,
  };
}

export const callCreateAccountFromCredentials = async (
  ctx: ActionCtx,
  args: Infer<typeof createAccountFromCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "createAccountFromCredentials",
      ...args,
    },
  });
};
