import { GenericId } from "convex/values";
import { Doc, MutationCtx } from "./types.js";
import { AuthProviderMaterializedConfig, ConvexAuthConfig } from "../types.js";
import { LOG_LEVELS, logWithLevel } from "./utils.js";
import { authDb } from "./db.js";
import { throwAuthError } from "../errors.js";

type CreateOrUpdateUserArgs = {
  type: "oauth" | "credentials" | "email" | "phone" | "verification";
  provider: AuthProviderMaterializedConfig;
  profile: Record<string, unknown> & {
    email?: string;
    phone?: string;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  };
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

export async function upsertUserAndAccount(
  ctx: MutationCtx,
  sessionId: GenericId<"session"> | null,
  account:
    | { existingAccount: Doc<"account"> }
    | {
        providerAccountId: string;
        secret?: string;
      },
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
): Promise<{
  userId: GenericId<"user">;
  accountId: GenericId<"account">;
}> {
  const userId = await defaultCreateOrUpdateUser(
    ctx,
    sessionId,
    "existingAccount" in account ? account.existingAccount : null,
    args,
    config,
  );
  const accountId = await createOrUpdateAccount(ctx, userId, account, args, config);
  return { userId, accountId };
}

async function defaultCreateOrUpdateUser(
  ctx: MutationCtx,
  existingSessionId: GenericId<"session"> | null,
  existingAccount: Doc<"account"> | null,
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
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
      emailVerified: profileEmailVerified,
      phoneVerified: profilePhoneVerified,
      ...profile
    },
  } = args;
  const emailVerified =
    profileEmailVerified ??
    ((provider.type === "oauth" || provider.type === "oidc") &&
      provider.allowDangerousEmailAccountLinking !== false);
  const phoneVerified = profilePhoneVerified ?? false;
  const shouldLinkViaEmail =
    args.shouldLinkViaEmail || emailVerified || provider.type === "email";
  const shouldLinkViaPhone =
    args.shouldLinkViaPhone || phoneVerified || provider.type === "phone";

  let userId = existingUserId;
  if (existingUserId === null) {
    const existingUserWithVerifiedEmailId =
      typeof profile.email === "string" && shouldLinkViaEmail
        ? (await uniqueUserWithVerifiedEmail(ctx, profile.email, config))?._id ??
          null
        : null;

    const existingUserWithVerifiedPhoneId =
      typeof profile.phone === "string" && shouldLinkViaPhone
        ? (await uniqueUserWithVerifiedPhone(ctx, profile.phone, config))?._id ??
          null
        : null;
    // If there is both email and phone verified user
    // already we can't link.
    if (
      existingUserWithVerifiedEmailId !== null &&
      existingUserWithVerifiedPhoneId !== null
    ) {
      logWithLevel(
        LOG_LEVELS.DEBUG,
        `Found existing email and phone verified users, so not linking: email: ${existingUserWithVerifiedEmailId}, phone: ${existingUserWithVerifiedPhoneId}`,
      );
      userId = null;
    } else if (existingUserWithVerifiedEmailId !== null) {
      logWithLevel(
        LOG_LEVELS.DEBUG,
        `Found existing email verified user, linking: ${existingUserWithVerifiedEmailId}`,
      );
      userId = existingUserWithVerifiedEmailId;
    } else if (existingUserWithVerifiedPhoneId !== null) {
      logWithLevel(
        LOG_LEVELS.DEBUG,
        `Found existing phone verified user, linking: ${existingUserWithVerifiedPhoneId}`,
      );
      userId = existingUserWithVerifiedPhoneId;
    } else {
      logWithLevel(
        LOG_LEVELS.DEBUG,
        "No existing verified users found, creating new user",
      );
      userId = null;
    }
  }
  const userData = {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
    ...profile,
  };
  const existingOrLinkedUserId = userId;
  if (userId !== null) {
    try {
      await db.users.patch(userId, userData);
    } catch (error) {
      throwAuthError("USER_UPDATE_FAILED", `Could not update user document with ID \`${userId}\`, ` +
          `either the user has been deleted but their account has not, ` +
          `or the profile data doesn't match the \`users\` table schema: ` +
          `${(error as Error).message}`);
    }
  } else {
    userId = (await db.users.insert(userData)) as GenericId<"user">;
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
  return (await db.users.findByVerifiedEmail(email)) as Doc<"user"> | null;
}

async function uniqueUserWithVerifiedPhone(
  ctx: MutationCtx,
  phone: string,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  return (await db.users.findByVerifiedPhone(phone)) as Doc<"user"> | null;
}

async function createOrUpdateAccount(
  ctx: MutationCtx,
  userId: GenericId<"user">,
  account:
    | { existingAccount: Doc<"account"> }
    | {
        providerAccountId: string;
        secret?: string;
      },
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
) {
  const db = authDb(ctx, config);
  const accountId =
    "existingAccount" in account
      ? account.existingAccount._id
      : ((await db.accounts.create({
          userId,
          provider: args.provider.id,
          providerAccountId: account.providerAccountId,
          secret: account.secret,
        })) as GenericId<"account">);
  // This is never used with the default `createOrUpdateUser` implementation,
  // but it is used for manual linking via custom `createOrUpdateUser`:
  if (
    "existingAccount" in account &&
    account.existingAccount.userId !== userId
  ) {
    await db.accounts.patch(accountId, { userId });
  }
  if (args.profile.emailVerified) {
    await db.accounts.patch(accountId, { emailVerified: args.profile.email });
  }
  if (args.profile.phoneVerified) {
    await db.accounts.patch(accountId, { phoneVerified: args.profile.phone });
  }
  return accountId;
}

export async function getAccountOrThrow(
  ctx: MutationCtx,
  existingAccountId: GenericId<"account">,
  config: ConvexAuthConfig,
) {
  const existingAccount = await authDb(ctx, config).accounts.getById(existingAccountId);
  if (existingAccount === null) {
    throwAuthError("ACCOUNT_NOT_FOUND", `Expected an account to exist for ID "${existingAccountId}"`);
  }
  return existingAccount;
}
