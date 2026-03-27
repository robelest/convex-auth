import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { getAuthSessionId } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { ConvexCredentialsConfig } from "../types";
import { upsertUserAndAccount } from "../users";
import { LOG_LEVELS, logWithLevel, maybeRedact } from "../utils";
import { AUTH_STORE_REF } from "./store/refs";

export const createAccountFromCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  profile: v.any(),
  shouldLinkViaEmail: v.optional(v.boolean()),
  shouldLinkViaPhone: v.optional(v.boolean()),
});

type ReturnType = { account: Doc<"Account">; user: Doc<"User"> };

export async function createAccountFromCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof createAccountFromCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<ReturnType> {
  logWithLevel(LOG_LEVELS.DEBUG, "createAccountFromCredentialsImpl args:", {
    provider: args.provider,
    account: {
      id: args.account.id,
      secret: maybeRedact(args.account.secret ?? ""),
    },
  });

  const {
    provider: providerId,
    account,
    profile,
    shouldLinkViaEmail,
    shouldLinkViaPhone,
  } = args;
  const db = authDb(ctx, config);
  const provider = getProviderOrThrow(providerId) as ConvexCredentialsConfig;

  return Fx.run(
    Fx.gen(function* () {
      const existingAccount = yield* Fx.promise(
        () =>
          db.accounts.get(
            provider.id,
            account.id,
          ) as Promise<Doc<"Account"> | null>,
      );

      if (existingAccount !== null) {
        if (account.secret !== undefined) {
          const valid = yield* Provider.verify(
            provider,
            account.secret,
            existingAccount.secret ?? "",
          );
          if (!valid) {
            return yield* Cv.fail({
              code: "ACCOUNT_ALREADY_EXISTS",
              message: `Account ${account.id} already exists`,
            });
          }
        }

        const user = yield* Fx.promise(
          () =>
            db.users.getById(
              existingAccount.userId,
            ) as Promise<Doc<"User"> | null>,
        );
        if (user === null) {
          return yield* Cv.fail({
            code: "ACCOUNT_NOT_FOUND",
            message: `Linked user for account ${account.id} was not found.`,
          });
        }

        return { account: existingAccount, user };
      }

      const secret =
        account.secret !== undefined
          ? yield* Provider.hash(provider, account.secret)
          : undefined;

      const result = yield* Fx.promise(async () =>
        upsertUserAndAccount(
          ctx,
          await getAuthSessionId(ctx),
          { providerAccountId: account.id, secret },
          {
            type: "credentials",
            provider,
            profile,
            shouldLinkViaEmail,
            shouldLinkViaPhone,
          },
          config,
        ),
      );

      const { userId, accountId } = result as {
        userId: string;
        accountId: string;
      };
      const [createdAccount, createdUser] = yield* Fx.zip(
        Fx.promise(
          () =>
            db.accounts.getById(accountId) as Promise<Doc<"Account"> | null>,
        ),
        Fx.promise(
          () => db.users.getById(userId) as Promise<Doc<"User"> | null>,
        ),
      );

      if (createdAccount === null) {
        return yield* Cv.fail({
          code: "ACCOUNT_NOT_FOUND",
          message: `Created account was not found.`,
        });
      }
      if (createdUser === null) {
        return yield* Cv.fail({
          code: "USER_UPDATE_FAILED",
          message: `Created user was not found.`,
        });
      }

      return { account: createdAccount, user: createdUser };
    }),
  ) as Promise<ReturnType>;
}

export const callCreateAccountFromCredentials = async <
  DataModel extends GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof createAccountFromCredentialsArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "createAccountFromCredentials",
      ...args,
    },
  });
};
