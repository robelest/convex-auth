import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../authError";
import * as Provider from "../crypto";
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
    Fx.from({
      ok: () =>
        db.accounts.get(
          provider.id,
          account.id,
        ) as Promise<Doc<"Account"> | null>,
      err: () => new AuthError("INTERNAL_ERROR", "Failed to look up account"),
    }).pipe(
      Fx.chain((existingAccount) => {
        if (existingAccount !== null) {
          const verifyExistingAccountFx =
            account.secret !== undefined
              ? Provider.verify(
                  provider,
                  account.secret,
                  existingAccount.secret ?? "",
                ).pipe(
                  Fx.chain((valid) =>
                    valid
                      ? Fx.succeed(undefined)
                      : Fx.fail(
                          new AuthError(
                            "ACCOUNT_ALREADY_EXISTS",
                            `Account ${account.id} already exists`,
                          ),
                        ),
                  ),
                )
              : Fx.succeed(undefined);

          return verifyExistingAccountFx.pipe(
            Fx.chain(() =>
              Fx.from({
                ok: () =>
                  db.users.getById(
                    existingAccount.userId,
                  ) as Promise<Doc<"User"> | null>,
                err: () =>
                  new AuthError(
                    "ACCOUNT_NOT_FOUND",
                    `Linked user for account ${account.id} was not found.`,
                  ),
              }).pipe(
                Fx.chain((doc) =>
                  doc === null
                    ? Fx.fail(
                        new AuthError(
                          "ACCOUNT_NOT_FOUND",
                          `Linked user for account ${account.id} was not found.`,
                        ),
                      )
                    : Fx.succeed(doc),
                ),
              ),
            ),
            Fx.map((user) => ({
              account: existingAccount,
              user,
            })),
          );
        }

        const secretFx: Fx<string | undefined, AuthError> =
          account.secret !== undefined
            ? Provider.hash(provider, account.secret)
            : Fx.succeed<string | undefined>(undefined);

        return secretFx.pipe(
          Fx.chain((secret) =>
            Fx.from({
              ok: async () =>
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
              err: () => new AuthError("INTERNAL_ERROR"),
            }),
          ),
          Fx.chain((result) => {
            const { userId, accountId } = result as {
              userId: string;
              accountId: string;
            };
            return Fx.zip(
              Fx.from({
                ok: () =>
                  db.accounts.getById(
                    accountId,
                  ) as Promise<Doc<"Account"> | null>,
                err: () => new AuthError("INTERNAL_ERROR"),
              }),
              Fx.from({
                ok: () =>
                  db.users.getById(userId) as Promise<Doc<"User"> | null>,
                err: () => new AuthError("INTERNAL_ERROR"),
              }),
            );
          }),
          Fx.chain((pair) => {
            const [createdAccount, createdUser] = pair as [
              Doc<"Account"> | null,
              Doc<"User"> | null,
            ];
            return createdAccount === null
              ? Fx.fail(
                  new AuthError(
                    "ACCOUNT_NOT_FOUND",
                    `Created account was not found.`,
                  ),
                )
              : createdUser === null
                ? Fx.fail(
                    new AuthError(
                      "USER_UPDATE_FAILED",
                      `Created user was not found.`,
                    ),
                  )
                : Fx.succeed({
                    account: createdAccount,
                    user: createdUser,
                  });
          }),
        );
      }),
      Fx.recover((e) => Fx.fatal((e as AuthError).toConvexError())),
    ),
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
