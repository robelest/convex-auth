import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, Infer, v } from "convex/values";
import { Effect, Match } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import type { AuthErrorData } from "../errors";
import { getAuthSessionId } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { ConvexCredentialsConfig } from "../types";
import { upsertUserAndAccount } from "../users";
import { LOG_LEVELS, log, maybeRedact } from "../log";
import type { AuthProfile } from "../payloads";
import { payloadRecordValidator } from "../payloads";
import { AUTH_STORE_REF } from "./store/refs";

export const createAccountFromCredentialsArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.optional(v.string()) }),
  profile: payloadRecordValidator,
  shouldLinkViaEmail: v.optional(v.boolean()),
  shouldLinkViaPhone: v.optional(v.boolean()),
});

type ReturnType = { account: Doc<"Account">; user: Doc<"User"> };

export function createAccountFromCredentialsImpl(
  ctx: MutationCtx,
  args: Infer<typeof createAccountFromCredentialsArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Effect.Effect<ReturnType, ConvexError<AuthErrorData>> {
  log(LOG_LEVELS.DEBUG, "createAccountFromCredentialsImpl args:", {
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
  const typedProfile = profile as AuthProfile;

  return Effect.flatMap(
    Effect.promise(
      () =>
        db.accounts.get(provider.id, account.id) as Promise<Doc<"Account"> | null>,
    ),
    (existingAccount) =>
      Match.value(existingAccount).pipe(
        Match.when(null, () =>
          Effect.gen(function* () {
            const accountSecret = account.secret;
            const secret =
              accountSecret === undefined
                ? undefined
                : yield* Provider.hash(provider, accountSecret);

            const result = yield* Effect.promise(async () =>
              upsertUserAndAccount(
                ctx,
                await getAuthSessionId(ctx),
                { providerAccountId: account.id, secret },
                {
                  type: "credentials",
                  provider,
                  profile: typedProfile,
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
            const [createdAccount, createdUser] = yield* Effect.all([
              Effect.promise(
                () => db.accounts.getById(accountId) as Promise<Doc<"Account"> | null>,
              ),
              Effect.promise(
                () => db.users.getById(userId) as Promise<Doc<"User"> | null>,
              ),
            ]);

            if (createdAccount === null) {
              return yield* Effect.fail(
                new ConvexError({
                  code: "ACCOUNT_NOT_FOUND",
                  message: "Created account was not found.",
                }),
              );
            }
            if (createdUser === null) {
              return yield* Effect.fail(
                new ConvexError({
                  code: "USER_UPDATE_FAILED",
                  message: "Created user was not found.",
                }),
              );
            }

            return { account: createdAccount, user: createdUser };
          }),
        ),
        Match.orElse((existingAccount) =>
          Effect.gen(function* () {
            if (account.secret !== undefined) {
              const accountSecret = account.secret;
              const valid = yield* Provider.verify(
                provider,
                accountSecret,
                existingAccount.secret ?? "",
              );
              if (!valid) {
                return yield* Effect.fail(
                  new ConvexError({
                    code: "INVALID_CREDENTIALS",
                    message: "Invalid credentials.",
                  }),
                );
              }
            }

            const user = yield* Effect.promise(
              () => db.users.getById(existingAccount.userId) as Promise<Doc<"User"> | null>,
            );
            if (user === null) {
              return yield* Effect.fail(
                new ConvexError({
                  code: "ACCOUNT_NOT_FOUND",
                  message: `Linked user for account ${account.id} was not found.`,
                }),
              );
            }

            return { account: existingAccount, user };
          }),
        ),
      ),
  );
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
  }) as Promise<ReturnType>;
};
