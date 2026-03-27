import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, Infer, v } from "convex/values";

import { GetProviderOrThrowFunc, hash } from "../crypto";
import * as Provider from "../crypto";
import { authDb } from "../db";
import { MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store/refs";

export const modifyAccountArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
});

export function modifyAccountImpl(
  ctx: MutationCtx,
  args: Infer<typeof modifyAccountArgs>,
  getProviderOrThrow: GetProviderOrThrowFunc,
  config: Provider.Config,
): Fx<void, ConvexError<any>> {
  const { provider, account } = args;
  const db = authDb(ctx, config);

  logWithLevel(LOG_LEVELS.DEBUG, "modifyAccountImpl args:", {
    provider,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  return Fx.gen(function* () {
    const existingAccount = yield* Fx.promise(() =>
      db.accounts.get(provider, account.id),
    );
    if (existingAccount === null) {
      return yield* Cv.fail({
        code: "ACCOUNT_NOT_FOUND",
        message: `Cannot modify account with ID ${account.id} because it does not exist`,
      });
    }
    const hashedSecret = yield* hash(
      getProviderOrThrow(provider),
      account.secret,
    );
    yield* Fx.promise(() =>
      db.accounts.patch(existingAccount._id, { secret: hashedSecret }),
    );
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
  });
};
