import { Infer, v } from "convex/values";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Doc, MutationCtx } from "../types";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../ratelimit";
import * as Provider from "../provider";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";

export const retrieveAccountWithCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
});

type ReturnType =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: Doc<"account">; user: Doc<"user"> };

export async function retrieveAccountWithCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof retrieveAccountWithCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const { provider: providerId, account } = args;
  const db = authDb(ctx, config);
  logWithLevel(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: {
      id: account.id,
      secret: maybeRedact(account.secret ?? ""),
    },
  });
  const existingAccount = (await db.accounts.get(
    providerId,
    account.id,
  )) as Doc<"account"> | null;
  if (existingAccount === null) {
    return "InvalidAccountId";
  }
  if (account.secret !== undefined) {
    if (await isSignInRateLimited(ctx, existingAccount._id, config)) {
      return "TooManyFailedAttempts";
    }
    if (
      !(await Provider.verify(
        getProviderOrThrow(providerId),
        account.secret,
        existingAccount.secret ?? "",
      ))
    ) {
      await recordFailedSignIn(ctx, existingAccount._id, config);
      return "InvalidSecret";
    }
    await resetSignInRateLimit(ctx, existingAccount._id, config);
  }
  const existingUser = (await db.users.getById(
    existingAccount.userId,
  )) as Doc<"user"> | null;
  if (existingUser === null) {
    logWithLevel(
      LOG_LEVELS.ERROR,
      `Account ${existingAccount._id} is linked to missing user ${existingAccount.userId}`,
    );
    return "InvalidAccountId";
  }

  return {
    account: existingAccount,
    user: existingUser,
  };
}

export const callRetrieveAccountWithCredentials = async <
  DataModel extends GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof retrieveAccountWithCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "retrieveAccountWithCredentials",
      ...args,
    },
  });
};

/** @deprecated Typo kept for backward compatibility. */
export const callRetreiveAccountWithCredentials =
  callRetrieveAccountWithCredentials;
