import { ConvexError, GenericId } from "convex/values";

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
  emails?: Array<{ email: string; primary?: boolean; verified?: boolean }>;
  shouldLinkViaEmail?: boolean;
  shouldLinkViaPhone?: boolean;
};

type UserProvisioningPolicy = GroupConnectionPolicy["provisioning"]["user"];

type UserProvisioningSource = "login" | "scim";

function mergeExtend(existing: unknown, incoming: Record<string, unknown> | undefined) {
  if (!incoming) {
    return undefined;
  }
  const existingRecord =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
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
  const accountId = await createOrUpdateAccount(ctx, userId, account, args, config);
  return { userId, accountId };
}

async function resolveUserIdByLinking(
  ctx: MutationCtx,
  args: CreateOrUpdateUserArgs,
  profile: Record<string, unknown>,
  shouldLinkViaEmail: boolean,
  shouldLinkViaPhone: boolean,
  existingUserIdOverride: GenericId<"User"> | null,
  config: ConvexAuthConfig,
): Promise<GenericId<"User"> | null> {
  const [emailLookup, phoneLookup] = await Promise.all([
    typeof profile.email === "string" && shouldLinkViaEmail
      ? uniqueUserWithVerifiedEmail(ctx, profile.email, config)
      : Promise.resolve(null),
    typeof profile.phone === "string" && shouldLinkViaPhone
      ? uniqueUserWithVerifiedPhone(ctx, profile.phone, config)
      : Promise.resolve(null),
  ]);
  const emailUserId = emailLookup?._id ?? null;
  const phoneUserId = phoneLookup?._id ?? null;

  if (emailUserId !== null && phoneUserId !== null) {
    if (emailUserId === phoneUserId) {
      log(LOG_LEVELS.DEBUG, `Email and phone resolve to same user, linking: ${emailUserId}`);
      return emailUserId;
    }
    throw new ConvexError({
      code: "AMBIGUOUS_USER_LINK",
      message: "Verified email and phone resolve to different users; cannot safely link.",
    });
  }
  if (emailUserId !== null) {
    log(LOG_LEVELS.DEBUG, `Found existing email verified user, linking: ${emailUserId}`);
    return emailUserId;
  }
  if (phoneUserId !== null) {
    log(LOG_LEVELS.DEBUG, `Found existing phone verified user, linking: ${phoneUserId}`);
    return phoneUserId;
  }
  log(LOG_LEVELS.DEBUG, "No existing verified users found, creating new user");
  return existingUserIdOverride;
}

async function checkAllowLink(
  args: CreateOrUpdateUserArgs,
  config: ConvexAuthConfig,
  userId: GenericId<"User">,
): Promise<boolean> {
  if (
    config.sso?.hooks?.allowLink === undefined ||
    (args.provider.type !== "oauth" && args.provider.type !== "sso")
  ) {
    return true;
  }
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
  return allowed !== false;
}

/**
 * Persist the emails this sign-in asserts onto the resolved user.
 *
 * The profile's primary email is recorded as the primary `UserEmail`
 * row; any provider-reported secondaries (e.g. GitHub `/user/emails`)
 * are recorded non-primary, each keeping its own verified state.
 * Provenance (`source`, `provider`, `connectionId`) is captured so SSO
 * linking can stay connection-scoped.
 *
 * @param db - The component-backed auth DB facade.
 * @param userId - The resolved (created or linked) user.
 * @param args - The create-or-update args (provider, accountExtend, emails).
 * @param profile - The provisioned profile (already destructured).
 * @param emailVerified - Whether the primary email is verified.
 */
async function recordOwnedEmails(
  db: ReturnType<typeof authDb>,
  userId: GenericId<"User">,
  args: CreateOrUpdateUserArgs,
  profile: Record<string, unknown>,
  emailVerified: boolean,
): Promise<void> {
  const identity = args.accountExtend?.identity;
  const protocol = typeof identity?.protocol === "string" ? identity.protocol : undefined;
  const source: "password" | "oauth" | "oidc" | "saml" | "scim" =
    protocol === "saml"
      ? "saml"
      : protocol === "oidc"
        ? "oidc"
        : args.provider.type === "oauth"
          ? "oauth"
          : "password";
  const provider = typeof args.provider.id === "string" ? args.provider.id : undefined;
  const connectionId =
    typeof identity?.connectionId === "string" ? identity.connectionId : undefined;
  const primaryEmail =
    typeof profile.email === "string" ? profile.email.toLowerCase() : null;

  if (primaryEmail !== null) {
    await db.emails.upsert({
      userId,
      email: primaryEmail,
      verified: emailVerified,
      isPrimary: true,
      source,
      provider,
      connectionId,
    });
  }
  for (const entry of args.emails ?? []) {
    const addr = entry.email.toLowerCase();
    if (addr === primaryEmail) continue;
    await db.emails.upsert({
      userId,
      email: addr,
      verified: entry.verified === true,
      isPrimary: false,
      source,
      provider,
      connectionId,
    });
  }
}

async function updateExistingUser(
  db: ReturnType<typeof authDb>,
  userId: GenericId<"User">,
  userData: Record<string, unknown>,
  source: UserProvisioningSource,
  provisioningUser: UserProvisioningPolicy | undefined,
) {
  const currentUser = (await db.users.getById(userId)) as Record<string, unknown> | null;
  const mode = effectiveUserUpdateMode(source, provisioningUser);
  const patchData = buildUserPatchData({
    currentUser: currentUser ?? {},
    nextUser: userData,
    mode,
  });
  if (Object.keys(patchData).length === 0) return;
  try {
    await db.users.patch(userId, patchData);
  } catch (error) {
    throw new ConvexError({
      code: "USER_UPDATE_FAILED",
      message:
        `Could not update user document with ID \`${userId}\`, ` +
        `either the user has been deleted but their account has not, ` +
        `or the profile data doesn't match the \`users\` table schema: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    });
  }
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

  const before = config.callbacks?.before;
  if (before !== undefined) {
    log(LOG_LEVELS.DEBUG, "Calling `before({ kind: \"link\" })` callback");
    const customUserId = await before(ctx, {
      kind: "link",
      existingUserId,
      type: args.type,
      provider: args.provider,
      profile: args.profile,
      shouldLink: args.shouldLinkViaEmail || args.shouldLinkViaPhone,
    });
    if (customUserId !== undefined) {
      // link callback contract: returns a User ID. Narrow.
      return customUserId as GenericId<"User">;
    }
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
    profileEmailVerified ?? (provider.type === "oauth" && provider.accountLinking !== "none");
  const phoneVerified = profilePhoneVerified ?? false;
  // Security: `"sameConnection"` (default for SSO connections) must never
  // globally merge users by email across IdPs/tenants — a connection may
  // only link to a user it already owns via its own account/externalId
  // (resolved upstream as `existingAccount`/`existingUserIdOverride`). The
  // email is still recorded as verified on the resolved user below; only
  // cross-user email linking is disabled here.
  const connectionScopedLinking =
    provider.type === "oauth" && provider.accountLinking === "sameConnection";
  const shouldLinkViaEmail =
    !connectionScopedLinking &&
    (args.shouldLinkViaEmail || emailVerified || provider.type === "email");
  const shouldLinkViaPhone =
    !connectionScopedLinking &&
    (args.shouldLinkViaPhone || phoneVerified || provider.type === "phone");

  let userId = existingUserId ?? existingUserIdOverride;
  if (existingUserId === null) {
    userId = await resolveUserIdByLinking(
      ctx, args, profile, shouldLinkViaEmail, shouldLinkViaPhone, existingUserIdOverride, config,
    );
    if (userId !== null && !(await checkAllowLink(args, config, userId))) {
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
    await updateExistingUser(db, userId, userData, source, provisioningUser);
  } else {
    if (source === "login" && provisioningUser?.createOnSignIn === false) {
      throw new ConvexError({
        code: "NOT_AUTHORIZED",
        message: "This SSO connection does not allow creating users on sign-in.",
      });
    }
    userId = (await db.users.insert(userData)) as GenericId<"User">;
  }

  await recordOwnedEmails(db, userId, args, profile, emailVerified === true);

  const after = config.callbacks?.after;
  if (after !== undefined) {
    log(LOG_LEVELS.DEBUG, "Calling `after` callback for user lifecycle event");
    if (existingOrLinkedUserId === null) {
      await after(ctx, {
        kind: "userCreated",
        userId,
        type: args.type,
        provider: args.provider,
        profile: args.profile,
      });
    } else {
      await after(ctx, {
        kind: "userUpdated",
        userId,
        existingUserId: existingOrLinkedUserId,
        type: args.type,
        provider: args.provider,
        profile: args.profile,
      });
    }
    if (emailVerified && typeof args.profile.email === "string") {
      await after(ctx, { kind: "emailVerified", userId, email: args.profile.email });
    }
    if (phoneVerified && typeof args.profile.phone === "string") {
      await after(ctx, { kind: "phoneVerified", userId, phone: args.profile.phone });
    }
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
  const isNewAccount = !("existingAccount" in account);
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
  if (isNewAccount) {
    await config.callbacks?.after?.(ctx, {
      kind: "accountLinked",
      userId,
      provider: args.provider.id,
      providerAccountId: (account as { providerAccountId: string }).providerAccountId,
    });
  }
  if ("existingAccount" in account && account.existingAccount.userId !== userId) {
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
