import { Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { GetProviderOrThrowFunc, hash } from "../provider.js";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils.js";
import * as Provider from "../provider.js";
import { createAuthDb } from "../db.js";

export const modifyAccountArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
});

export async function modifyAccountImpl(
  ctx: MutationCtx,
  args: Infer<typeof modifyAccountArgs>,
  getProviderOrThrow: GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<void> {
  const { provider, account } = args;
  const authDb =
    config.component !== undefined ? createAuthDb(ctx, config.component) : null;
  logWithLevel(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: provider,
    account: {
      id: account.id,
      secret: maybeRedact(account.secret ?? ""),
    },
  });
  const existingAccount =
    authDb !== null
      ? await authDb.accounts.get(provider, account.id)
      : await ctx.db
          .query("account")
          .withIndex("providerAndAccountId", (q) =>
            q.eq("provider", provider).eq("providerAccountId", account.id),
          )
          .unique();
  if (existingAccount === null) {
    throw new Error(
      `Cannot modify account with ID ${account.id} because it does not exist`,
    );
  }
  if (authDb !== null) {
    await authDb.accounts.patch(existingAccount._id, {
      secret: await hash(getProviderOrThrow(provider), account.secret),
    });
  } else {
    await ctx.db.patch(existingAccount._id, {
      secret: await hash(getProviderOrThrow(provider), account.secret),
    });
  }
  return;
}

export const callModifyAccount = async (
  ctx: ActionCtx,
  args: Infer<typeof modifyAccountArgs>,
): Promise<void> => {
  return ctx.runMutation("auth:store" as any, {
    args: {
      type: "modifyAccount",
      ...args,
    },
  });
};
