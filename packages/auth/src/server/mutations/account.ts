import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../fx";
import { GetProviderOrThrowFunc, hash } from "../provider";
import * as Provider from "../provider";
import { MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store";

export const modifyAccountArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
});

export function modifyAccountImpl(
  ctx: MutationCtx,
  args: Infer<typeof modifyAccountArgs>,
  getProviderOrThrow: GetProviderOrThrowFunc,
  config: Provider.Config,
): Fx<void, AuthError> {
  const { provider, account } = args;
  const db = authDb(ctx, config);

  logWithLevel(LOG_LEVELS.DEBUG, "modifyAccountImpl args:", {
    provider,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  return Fx.from({
    ok: () => db.accounts.get(provider, account.id),
    err: () =>
      new AuthError(
        "ACCOUNT_NOT_FOUND",
        `Cannot modify account with ID ${account.id} because it does not exist`,
      ),
  }).pipe(
    Fx.chain((doc) =>
      doc === null
        ? Fx.fail(
            new AuthError(
              "ACCOUNT_NOT_FOUND",
              `Cannot modify account with ID ${account.id} because it does not exist`,
            ),
          )
        : Fx.succeed(doc),
    ),
    Fx.chain((existingAccount) =>
      hash(getProviderOrThrow(provider), account.secret).pipe(
        Fx.chain((hashedSecret) =>
          Fx.from({
            ok: () =>
              db.accounts.patch(existingAccount._id, { secret: hashedSecret }),
            err: () =>
              new AuthError("INTERNAL_ERROR", "Failed to patch account"),
          }),
        ),
      ),
    ),
    Fx.map(() => undefined),
  );
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
