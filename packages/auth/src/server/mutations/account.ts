import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, Infer, v } from "convex/values";

import { GetProviderOrThrowFunc, hash } from "../crypto";
import * as Provider from "../crypto";
import { authDb } from "../db";
import type { AuthErrorData } from "../errors";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

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

  log(LOG_LEVELS.DEBUG, "modifyAccountImpl args:", {
    provider,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  const existingAccount = await db.accounts.get(provider, account.id);

  if (existingAccount === null) {
    throw new ConvexError<AuthErrorData>({
      code: "ACCOUNT_NOT_FOUND",
      message: `Cannot modify account with ID ${account.id} because it does not exist`,
    });
  }

  const hashedSecret = await hash(getProviderOrThrow(provider), account.secret);
  await db.accounts.patch(existingAccount._id, {
    secret: hashedSecret,
  });
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
  }) as Promise<void>;
};
