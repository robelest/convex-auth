import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";
import { Effect, Match } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import {
  isSignInRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../limits";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import { Doc, MutationCtx } from "../types";
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
): Effect.Effect<ReturnType> {
  const { provider: providerId, account } = args;
  const db = authDb(ctx, config);

  log(LOG_LEVELS.DEBUG, "retrieveAccountWithCredentialsImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret ?? "") },
  });

  return Effect.catch(
    Effect.gen(function* () {
      const existingAccount = yield* Effect.promise(
        () =>
          db.accounts.get(
            providerId,
            account.id,
          ) as Promise<Doc<"Account"> | null>,
      );
      if (existingAccount === null) {
        return "InvalidAccountId" as const;
      }

      if (account.secret !== undefined) {
        const accountSecret = account.secret;
        const limited = yield* isSignInRateLimited(
          ctx,
          existingAccount._id,
          config,
        );
        if (limited) {
          return "TooManyFailedAttempts" as const;
        }

        const valid = yield* Provider.verify(
          getProviderOrThrow(providerId),
          accountSecret,
          existingAccount.secret ?? "",
        );
        if (!valid) {
          yield* recordFailedSignIn(ctx, existingAccount._id, config);
          return "InvalidSecret" as const;
        }

        yield* resetSignInRateLimit(ctx, existingAccount._id, config);
      }

      const user = yield* Effect.promise(
        () =>
          db.users.getById(
            existingAccount.userId,
          ) as Promise<Doc<"User"> | null>,
      );

      return yield* Match.value(user).pipe(
        Match.when(null, () => {
          log(
            LOG_LEVELS.ERROR,
            `Account ${existingAccount._id} is linked to missing user ${existingAccount.userId}`,
          );
          return Effect.succeed("InvalidAccountId" as const);
        }),
        Match.orElse((user) =>
          Effect.succeed({ account: existingAccount, user } as ReturnType),
        ),
      );
    }),
    () => Effect.succeed("InvalidAccountId" as ReturnType),
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
  }) as Promise<ReturnType>;
};
