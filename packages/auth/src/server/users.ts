import { Fx } from "@robelest/fx";
import { GenericId } from "convex/values";

import { authDb } from "./db";
import { AuthError } from "./fx";
import { Doc, MutationCtx } from "./types";
import { AuthProviderMaterializedConfig, ConvexAuthConfig } from "./types";
import { LOG_LEVELS, logWithLevel } from "./utils";

type CreateOrUpdateUserArgs = {
  type: "oauth" | "credentials" | "email" | "phone" | "verification";
  provider: AuthProviderMaterializedConfig;
  profile: Record<string, unknown> & {
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  };
  accountExtend?: Record<string, unknown>;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

function mergeExtend(
  existing: unknown,
  incoming: Record<string, unknown> | undefined,
) {
  if (!incoming) {
    return undefined;
  }
  const existingRecord =
    typeof existing === "object" &&
    existing !== null &&
    !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : undefined;
  return existingRecord ? { ...existingRecord, ...incoming } : incoming;
}

export async function upsertUserAndAccount(
  ctx: MutationCtx,
  sessionId: GenericId<"Session"> | null,
  account:
    | { existingAccount: Doc<"Account"> }
    | {
        providerAccountId: string;
        secret?: string;
      },
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
  opts?: { existingUserId?: GenericId<"User"> },
): Promise<{
  userId: GenericId<"User">;
  accountId: GenericId<"Account">;
}> {
  const userId = await defaultCreateOrUpdateUser(
    ctx,
    sessionId,
    "existingAccount" in account ? account.existingAccount : null,
    args,
    config,
    opts?.existingUserId ?? null,
  );
  const accountId = await createOrUpdateAccount(
    ctx,
    userId,
    account,
    args,
    config,
  );
  return { userId, accountId };
}

async function defaultCreateOrUpdateUser(
  ctx: MutationCtx,
  existingSessionId: GenericId<"Session"> | null,
  existingAccount: Doc<"Account"> | null,
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
  existingUserIdOverride: GenericId<"User"> | null,
) {
  logWithLevel(LOG_LEVELS.DEBUG, "defaultCreateOrUpdateUser args:", {
    existingAccountId: existingAccount?._id,
    existingSessionId,
    args,
  });
  const existingUserId = existingAccount?.userId ?? null;
  const db = authDb(ctx, config);
  if (config.callbacks?.createOrUpdateUser !== undefined) {
    logWithLevel(LOG_LEVELS.DEBUG, "Using custom createOrUpdateUser callback");
    return await config.callbacks.createOrUpdateUser(ctx, {
      existingUserId,
      ...args,
    });
  }

  const {
    provider,
    profile: {
      id: _profileId,
      emailVerified: profileEmailVerified,
      phoneVerified: profilePhoneVerified,
      ...profile
    },
  } = args;
  const emailVerified =
    profileEmailVerified ??
    (provider.type === "oauth" && provider.accountLinking !== "none");
  const phoneVerified = profilePhoneVerified ?? false;
  const shouldLinkViaEmail =
    args.shouldLinkViaEmail || emailVerified || provider.type === "email";
  const shouldLinkViaPhone =
    args.shouldLinkViaPhone || phoneVerified || provider.type === "phone";

  let userId = existingUserId ?? existingUserIdOverride;
  if (existingUserId === null) {
    const existingUserWithVerifiedEmailId =
      typeof profile.email === "string" && shouldLinkViaEmail
        ? ((await uniqueUserWithVerifiedEmail(ctx, profile.email, config))
            ?._id ?? null)
        : null;

    const existingUserWithVerifiedPhoneId =
      typeof profile.phone === "string" && shouldLinkViaPhone
        ? ((await uniqueUserWithVerifiedPhone(ctx, profile.phone, config))
            ?._id ?? null)
        : null;
    const linkDispatch = {
      tag:
        existingUserWithVerifiedEmailId !== null &&
        existingUserWithVerifiedPhoneId !== null
          ? "both"
          : existingUserWithVerifiedEmailId !== null
            ? "email"
            : existingUserWithVerifiedPhoneId !== null
              ? "phone"
              : "none",
      existingUserWithVerifiedEmailId,
      existingUserWithVerifiedPhoneId,
    } as const;

    const linkHandlers = {
      both: () =>
        Fx.sync(() => {
          logWithLevel(
            LOG_LEVELS.DEBUG,
            `Found existing email and phone verified users, so not linking: email: ${linkDispatch.existingUserWithVerifiedEmailId}, phone: ${linkDispatch.existingUserWithVerifiedPhoneId}`,
          );
          return null;
        }),
      email: () =>
        Fx.sync(() => {
          logWithLevel(
            LOG_LEVELS.DEBUG,
            `Found existing email verified user, linking: ${linkDispatch.existingUserWithVerifiedEmailId}`,
          );
          return linkDispatch.existingUserWithVerifiedEmailId;
        }),
      phone: () =>
        Fx.sync(() => {
          logWithLevel(
            LOG_LEVELS.DEBUG,
            `Found existing phone verified user, linking: ${linkDispatch.existingUserWithVerifiedPhoneId}`,
          );
          return linkDispatch.existingUserWithVerifiedPhoneId;
        }),
      none: () =>
        Fx.sync(() => {
          logWithLevel(
            LOG_LEVELS.DEBUG,
            "No existing verified users found, creating new user",
          );
          return null;
        }),
    } as const;

    userId = await Fx.run(linkHandlers[linkDispatch.tag]());
  }
  const userData = {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
    ...profile,
  };
  const existingOrLinkedUserId = userId;
  if (userId !== null) {
    await Fx.run(
      Fx.from({
        ok: () => db.users.patch(userId!, userData),
        err: (error) =>
          new AuthError(
            "USER_UPDATE_FAILED",
            `Could not update user document with ID \`${userId}\`, ` +
              `either the user has been deleted but their account has not, ` +
              `or the profile data doesn't match the \`users\` table schema: ` +
              `${(error as Error).message}`,
          ),
      }).pipe(Fx.recover((e) => Fx.fatal(e.toConvexError()))),
    );
  } else {
    userId = (await db.users.insert(userData)) as GenericId<"User">;
  }
  const afterUserCreatedOrUpdated = config.callbacks?.afterUserCreatedOrUpdated;
  if (afterUserCreatedOrUpdated !== undefined) {
    logWithLevel(
      LOG_LEVELS.DEBUG,
      "Calling custom afterUserCreatedOrUpdated callback",
    );
    await afterUserCreatedOrUpdated(ctx, {
      userId,
      existingUserId: existingOrLinkedUserId,
      ...args,
    });
  } else {
    logWithLevel(
      LOG_LEVELS.DEBUG,
      "No custom afterUserCreatedOrUpdated callback, skipping",
    );
  }
  return userId;
}

async function uniqueUserWithVerifiedEmail(
  ctx: MutationCtx,
  email: string,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  return (await db.users.findByVerifiedEmail(email)) as Doc<"User"> | null;
}

async function uniqueUserWithVerifiedPhone(
  ctx: MutationCtx,
  phone: string,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  return (await db.users.findByVerifiedPhone(phone)) as Doc<"User"> | null;
}

async function createOrUpdateAccount(
  ctx: MutationCtx,
  userId: GenericId<"User">,
  account:
    | { existingAccount: Doc<"Account"> }
    | {
        providerAccountId: string;
        secret?: string;
      },
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const mergedExtend =
    "existingAccount" in account
      ? mergeExtend(account.existingAccount.extend, args.accountExtend)
      : args.accountExtend;
  const accountId =
    "existingAccount" in account
      ? account.existingAccount._id
      : ((await db.accounts.create({
          userId,
          provider: args.provider.id,
          providerAccountId: account.providerAccountId,
          secret: account.secret,
          extend: mergedExtend,
        })) as GenericId<"Account">);
  // This is never used with the default `createOrUpdateUser` implementation,
  // but it is used for manual linking via custom `createOrUpdateUser`:
  if (
    "existingAccount" in account &&
    account.existingAccount.userId !== userId
  ) {
    await db.accounts.patch(accountId, { userId });
  }
  const accountPatchData: Record<string, unknown> = {};
  if (mergedExtend) {
    accountPatchData.extend = mergedExtend;
  }
  if (args.profile.emailVerified) {
    accountPatchData.emailVerified = args.profile.email;
  }
  if (args.profile.phoneVerified) {
    accountPatchData.phoneVerified = args.profile.phone;
  }
  if (Object.keys(accountPatchData).length > 0) {
    await db.accounts.patch(accountId, accountPatchData);
  }
  return accountId;
}
