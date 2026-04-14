import { ConvexError, GenericId } from "convex/values";
import { Effect, Match } from "effect";

import { authDb } from "./db";
import { LOG_LEVELS } from "./log";
import { log } from "./log";
import type { AuthAccountExtend, AuthProfile } from "./payloads";
import type {
  AuthProviderMaterializedConfig,
  ConvexAuthConfig,
  Doc,
  GroupConnectionPolicy,
  MutationCtx,
} from "./types";

type CreateOrUpdateUserArgs = {
  type: "oauth" | "credentials" | "email" | "phone" | "verification";
  provider: AuthProviderMaterializedConfig;
  profile: AuthProfile;
  accountExtend?: AuthAccountExtend;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

type UserProvisioningPolicy = GroupConnectionPolicy["provisioning"]["user"];

type UserProvisioningSource = "login" | "scim";

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

function effectiveUserUpdateMode(
  source: UserProvisioningSource,
  policy: UserProvisioningPolicy | undefined,
) {
  const authority = policy?.authority ?? "app";
  let mode =
    source === "login"
      ? (policy?.updateProfileOnLogin ?? "missing")
      : (policy?.updateProfileFromScim ?? "always");

  if (authority === "app") {
    return mode === "never" ? "never" : "missing";
  }
  if (authority === "sso" && source === "scim") {
    return mode === "never" ? "never" : "missing";
  }
  if (authority === "scim" && source === "login") {
    return mode === "never" ? "never" : "missing";
  }
  return mode;
}

function isUserFieldMissing(value: unknown) {
  return value === undefined || value === null || value === "";
}

function buildUserPatchData(args: {
  currentUser: Record<string, unknown>;
  nextUser: Record<string, unknown>;
  mode: "never" | "missing" | "always";
}) {
  if (args.mode === "never") {
    return {};
  }
  if (args.mode === "always") {
    return args.nextUser;
  }
  return Object.fromEntries(
    Object.entries(args.nextUser).filter(([key, value]) => {
      if (value === undefined) {
        return false;
      }
      return isUserFieldMissing(args.currentUser[key]);
    }),
  );
}

/** @internal */
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
  opts?: {
    existingUserId?: GenericId<"User">;
    provisioningUser?: UserProvisioningPolicy;
    source?: UserProvisioningSource;
  },
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
    opts?.provisioningUser,
    opts?.source ?? "login",
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
  provisioningUser: UserProvisioningPolicy | undefined,
  source: UserProvisioningSource,
) {
  log(LOG_LEVELS.DEBUG, "defaultCreateOrUpdateUser args:", {
    existingAccountId: existingAccount?._id,
    existingSessionId,
    args,
  });
  const existingUserId = existingAccount?.userId ?? null;
  const db = authDb(ctx, config);
  if (config.callbacks?.createOrUpdateUser !== undefined) {
    log(LOG_LEVELS.DEBUG, "Using custom createOrUpdateUser callback");
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

    userId = await Effect.runPromise(
      Match.value(linkDispatch).pipe(
        Match.when(
          { tag: "both" },
          ({
            existingUserWithVerifiedEmailId,
            existingUserWithVerifiedPhoneId,
          }) =>
            Effect.sync(() => {
              log(
                LOG_LEVELS.DEBUG,
                `Found existing email and phone verified users, so not linking: email: ${existingUserWithVerifiedEmailId}, phone: ${existingUserWithVerifiedPhoneId}`,
              );
              return null;
            }),
        ),
        Match.when({ tag: "email" }, ({ existingUserWithVerifiedEmailId }) =>
          Effect.sync(() => {
            log(
              LOG_LEVELS.DEBUG,
              `Found existing email verified user, linking: ${existingUserWithVerifiedEmailId}`,
            );
            return existingUserWithVerifiedEmailId;
          }),
        ),
        Match.when({ tag: "phone" }, ({ existingUserWithVerifiedPhoneId }) =>
          Effect.sync(() => {
            log(
              LOG_LEVELS.DEBUG,
              `Found existing phone verified user, linking: ${existingUserWithVerifiedPhoneId}`,
            );
            return existingUserWithVerifiedPhoneId;
          }),
        ),
        Match.when({ tag: "none" }, () =>
          Effect.sync(() => {
            log(
              LOG_LEVELS.DEBUG,
              "No existing verified users found, creating new user",
            );
            return null;
          }),
        ),
        Match.exhaustive,
      ),
    );

    if (
      userId !== null &&
      config.sso?.hooks?.allowLink !== undefined &&
      (args.provider.type === "oauth" || args.provider.type === "sso")
    ) {
      const allowed = await config.sso.hooks.allowLink({
        protocol:
          args.provider.type === "oauth" &&
          typeof args.accountExtend?.identity?.protocol === "string"
            ? (args.accountExtend.identity.protocol as "oidc" | "saml")
            : "oidc",
        connectionId:
          typeof args.accountExtend?.identity?.connectionId === "string"
            ? args.accountExtend.identity.connectionId
            : undefined,
        profile: args.profile,
        userId,
      });
      if (allowed === false) {
        userId = null;
      }
    }
  }

  const userData = {
    ...(emailVerified ? { emailVerificationTime: Date.now() } : null),
    ...(phoneVerified ? { phoneVerificationTime: Date.now() } : null),
    ...profile,
  };
  const existingOrLinkedUserId = userId;
  if (userId !== null) {
    const currentUserId = userId;
    const currentUser = (await db.users.getById(currentUserId)) as Record<
      string,
      unknown
    > | null;
    const mode = effectiveUserUpdateMode(source, provisioningUser);
    const patchData = buildUserPatchData({
      currentUser: currentUser ?? {},
      nextUser: userData,
      mode,
    });
    if (Object.keys(patchData).length === 0) {
      return userId;
    }
    await Effect.runPromise(
      Effect.tryPromise({
        try: () => db.users.patch(currentUserId, patchData),
        catch: (error) =>
          new ConvexError({
            code: "USER_UPDATE_FAILED",
            message:
              `Could not update user document with ID \`${currentUserId}\`, ` +
              `either the user has been deleted but their account has not, ` +
              `or the profile data doesn't match the \`users\` table schema: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          }),
      }),
    );
  } else {
    if (source === "login" && provisioningUser?.createOnSignIn === false) {
      throw new ConvexError({
        code: "NOT_AUTHORIZED",
        message:
          "This SSO connection does not allow creating users on sign-in.",
      });
    }
    userId = (await db.users.insert(userData)) as GenericId<"User">;
  }

  const afterUserCreatedOrUpdated = config.callbacks?.afterUserCreatedOrUpdated;
  if (afterUserCreatedOrUpdated !== undefined) {
    log(LOG_LEVELS.DEBUG, "Calling custom afterUserCreatedOrUpdated callback");
    await afterUserCreatedOrUpdated(ctx, {
      userId,
      existingUserId: existingOrLinkedUserId,
      ...args,
    });
  } else {
    log(
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
