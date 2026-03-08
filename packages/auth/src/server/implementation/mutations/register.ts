import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { throwAuthError } from "../../errors";
import { ConvexCredentialsConfig } from "../../types";
import { authDb } from "../db";
import * as Provider from "../provider";
import { getAuthSessionId } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { upsertUserAndAccount } from "../users";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store";

export const createAccountFromCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  profile: v.any(),
  shouldLinkViaEmail: v.optional(v.boolean()),
  shouldLinkViaPhone: v.optional(v.boolean()),
});

type ReturnType = { account: Doc<"Account">; user: Doc<"User"> };

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
  )) as Doc<"Account"> | null;
  if (existingAccount !== null) {
    if (
      account.secret !== undefined &&
      !(await Provider.verify(
        provider,
        account.secret,
        existingAccount.secret ?? "",
      ))
    ) {
      throwAuthError(
        "ACCOUNT_ALREADY_EXISTS",
        `Account ${account.id} already exists`,
      );
    }
    const existingUser = (await db.users.getById(
      existingAccount.userId,
    )) as Doc<"User"> | null;
    if (existingUser === null) {
      throwAuthError(
        "ACCOUNT_NOT_FOUND",
        `Linked user for account ${account.id} was not found.`,
      );
    }

    return {
      account: existingAccount,
      user: existingUser,
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

  const createdAccount = (await db.accounts.getById(
    accountId,
  )) as Doc<"Account"> | null;
  if (createdAccount === null) {
    throwAuthError(
      "ACCOUNT_NOT_FOUND",
      `Created account ${accountId} was not found.`,
    );
  }

  const createdUser = (await db.users.getById(userId)) as Doc<"User"> | null;
  if (createdUser === null) {
    throwAuthError(
      "USER_UPDATE_FAILED",
      `Created user ${userId} was not found.`,
    );
  }

  return {
    account: createdAccount,
    user: createdUser,
  };
}

export const callCreateAccountFromCredentials = async <
  DataModel extends GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof createAccountFromCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "createAccountFromCredentials",
      ...args,
    },
  });
};
