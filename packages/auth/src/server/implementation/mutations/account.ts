import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { throwAuthError } from "../../errors";
import { authDb } from "../db";
import { GetProviderOrThrowFunc, hash } from "../provider";
import * as Provider from "../provider";
import { MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store";

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
    throwAuthError(
      "ACCOUNT_NOT_FOUND",
      `Cannot modify account with ID ${account.id} because it does not exist`,
    );
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
