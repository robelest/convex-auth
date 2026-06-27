import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import type { Hashed } from "../../shared/brand";
import { authDb } from "../db";
import { isSignInRateLimited, recordFailedSignIn, resetSignInRateLimit } from "../limits";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { Doc, MutationCtx } from "../types";
import { withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const vRetrieveAccountWithCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
});

type ReturnType =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: Doc<"Account">; user: Doc<"User"> };

export async function retrieveAccountWithCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof vRetrieveAccountWithCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  const { provider: providerId, account } = args;
  const db = authDb(ctx, config);

  log(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  try {
    const existingAccount = (await db.accounts.get({
      provider: providerId,
      providerAccountId: account.id,
    })) as Doc<"Account"> | null;
    if (existingAccount === null) {
      return "InvalidAccountId" as const;
    }

    if (account.secret !== undefined) {
      const accountSecret = account.secret;
      const limited = await isSignInRateLimited(ctx, existingAccount._id, config);
      if (limited) {
        return "TooManyFailedAttempts" as const;
      }

      const valid = await withSpan("convex-auth.credentials.verify", { providerId }, () =>
        Provider.verify(
          getProviderOrThrow(providerId),
          accountSecret,
          (existingAccount.secret ?? "") as Hashed<"Password">,
        ),
      );
      if (!valid) {
        await recordFailedSignIn(ctx, existingAccount._id, config);
        return "InvalidSecret" as const;
      }

      await resetSignInRateLimit(ctx, existingAccount._id, config);
    }

    const user = (await db.users.get({ id: existingAccount.userId })) as Doc<"User"> | null;

    if (user === null) {
      log(
        LOG_LEVELS.ERROR,
        `Account ${existingAccount._id} is linked to missing user ${existingAccount.userId}`,
      );
      return "InvalidAccountId" as const;
    }

    return { account: existingAccount, user } as ReturnType;
  } catch {
    return "InvalidAccountId" as ReturnType;
  }
}

export const callRetrieveAccountWithCredentials = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vRetrieveAccountWithCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "retrieveAccountWithCredentials",
      ...args,
    },
  }) as Promise<ReturnType>;
};
