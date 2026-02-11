import { Infer, v } from "convex/values";
import { ActionCtx, Doc, MutationCtx } from "../types.js";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../rateLimit.js";
import * as Provider from "../provider.js";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./storeRef.js";

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
  return {
    account: existingAccount,
    // TODO: Ian removed this
    user: (await db.users.getById(existingAccount.userId)) as unknown as Doc<"user">,
  };
}

export const callRetreiveAccountWithCredentials = async (
  ctx: ActionCtx,
  args: Infer<typeof retrieveAccountWithCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "retrieveAccountWithCredentials",
      ...args,
    },
  });
};
