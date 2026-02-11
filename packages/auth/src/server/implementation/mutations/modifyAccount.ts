import { Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { GetProviderOrThrowFunc, hash } from "../provider.js";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils.js";
import * as Provider from "../provider.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./storeRef.js";

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
  const db = authDb(ctx, config);
  logWithLevel(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: provider,
    account: {
      id: account.id,
      secret: maybeRedact(account.secret ?? ""),
    },
  });
  const existingAccount = await db.accounts.get(provider, account.id);
  if (existingAccount === null) {
    throw new Error(
      `Cannot modify account with ID ${account.id} because it does not exist`,
    );
  }
  await db.accounts.patch(existingAccount._id, {
    secret: await hash(getProviderOrThrow(provider), account.secret),
  });
  return;
}

export const callModifyAccount = async (
  ctx: ActionCtx,
  args: Infer<typeof modifyAccountArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "modifyAccount",
      ...args,
    },
  });
};
