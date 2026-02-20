import { Infer, v } from "convex/values";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { MutationCtx } from "../types";
import { GetProviderOrThrowFunc, hash } from "../provider";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import * as Provider from "../provider";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";
import { throwAuthError } from "../../errors";

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
    throwAuthError("ACCOUNT_NOT_FOUND", `Cannot modify account with ID ${account.id} because it does not exist`);
  }
  await db.accounts.patch(existingAccount._id, {
    secret: await hash(getProviderOrThrow(provider), account.secret),
  });
  return;
}

export const callModifyAccount = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof modifyAccountArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "modifyAccount",
      ...args,
    },
  });
};
