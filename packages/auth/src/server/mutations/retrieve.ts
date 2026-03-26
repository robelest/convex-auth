import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../authError";
import * as Provider from "../crypto";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../limits";
import { Doc, MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store/refs";

export const retrieveAccountWithCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
});

type ReturnType =
  | "InvalidAccountId"
  | "TooManyFailedAttempts"
  | "InvalidSecret"
  | { account: Doc<"Account">; user: Doc<"User"> };

export function retrieveAccountWithCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof retrieveAccountWithCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Fx<ReturnType> {
  const { provider: providerId, account } = args;
  const db = authDb(ctx, config);

  logWithLevel(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  return Fx.from({
    ok: async () => {
      const existingAccount = (await db.accounts.get(
        providerId,
        account.id,
      )) as Doc<"Account"> | null;
      if (existingAccount === null) {
        return "InvalidAccountId" as const;
      }

      if (account.secret !== undefined) {
        const limited = await Fx.run(
          isSignInRateLimited(ctx, existingAccount._id, config),
        );
        if (limited) {
          return "TooManyFailedAttempts" as const;
        }

        const valid = await Fx.run(
          Provider.verify(
            getProviderOrThrow(providerId),
            account.secret,
            existingAccount.secret ?? "",
          ),
        );
        if (!valid) {
          await Fx.run(recordFailedSignIn(ctx, existingAccount._id, config));
          return "InvalidSecret" as const;
        }

        await Fx.run(resetSignInRateLimit(ctx, existingAccount._id, config));
      }

      const user = (await db.users.getById(
        existingAccount.userId,
      )) as Doc<"User"> | null;
      if (user === null) {
        logWithLevel(
          LOG_LEVELS.ERROR,
          `Account ${existingAccount._id} is linked to missing user ${existingAccount.userId}`,
        );
        return "InvalidAccountId" as const;
      }

      return { account: existingAccount, user } as const;
    },
    err: () => new AuthError("INTERNAL_ERROR", "Failed to look up account"),
  }).pipe(
    Fx.fold({
      ok: (v) => v as ReturnType,
      err: () => "InvalidAccountId" as ReturnType,
    }),
  );
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
