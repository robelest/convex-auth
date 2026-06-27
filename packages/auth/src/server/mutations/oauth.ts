import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import { ErrorCode } from "../../shared/codes";
import { GenericId, Infer, v } from "convex/values";

import { getGroup, getGroupConnection } from "../contract";
import * as Provider from "../crypto";
import { authDb } from "../db";
import { log } from "../log";
import type { AuthAccountExtend, AuthProfile } from "../payloads";
import { vAccountExtend, vPayloadRecord } from "../payloads";
import { vProfileEmail } from "../../component/model";
import { single } from "../component/api";
import { generateRandomString, sha256 } from "../random";
import { createSyntheticOAuthMaterializedConfig } from "../connection/oidc";
import { normalizeGroupConnectionPolicy, resolveProvisionedRoleIds } from "../connection/policy";
import {
  GROUP_OIDC_PROVIDER_PREFIX,
  GROUP_SAML_PROVIDER_PREFIX,
  isGroupProviderId,
} from "../connection/shared";
import { MutationCtx } from "../types";
import type { AuthProviderMaterializedConfig } from "../types";
import { upsertUserAndAccount } from "../user/account";
import { AUTH_STORE_REF } from "./store/refs";

const OAUTH_SIGN_IN_EXPIRATION_MS = 1000 * 60 * 2;

/** Argument validator for the OAuth/Connection user provisioning mutation. */
export const vUserOAuthArgs = v.object({
  provider: v.string(),
  providerAccountId: v.string(),
  profile: vPayloadRecord,
  emails: v.optional(v.array(vProfileEmail)),
  signature: v.string(),
  accountExtend: v.optional(vAccountExtend),
});

function normalizeAccountExtend(
  provider: string,
  providerAccountId: string,
  accountExtend: AuthAccountExtend | undefined,
) {
  const baseIdentity: Record<string, unknown> = {
    type: "oauth",
    provider,
    providerAccountId,
  };
  if (provider.startsWith(GROUP_OIDC_PROVIDER_PREFIX)) {
    baseIdentity.type = "group-connection-oidc";
    baseIdentity.connectionId = provider.slice(GROUP_OIDC_PROVIDER_PREFIX.length);
  }
  if (provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)) {
    baseIdentity.type = "group-connection-saml";
    baseIdentity.connectionId = provider.slice(GROUP_SAML_PROVIDER_PREFIX.length);
  }
  const provided = accountExtend;
  const providedIdentity = provided?.identity;
  return {
    ...provided,
    identity: {
      ...baseIdentity,
      ...providedIdentity,
    },
  };
}

/**
 * Read a free-form string-array claim (e.g. `groups`, `roles`) from an IdP
 * profile. The value arrives as untyped wire data; the array branch is
 * re-narrowed to `string[]` at this single boundary.
 */
function readStringArrayClaim(profile: AuthProfile, key: string): string[] | undefined {
  const value = profile[key];
  return Array.isArray(value) ? (value as string[]) : undefined;
}

async function jitProvisionMembership(
  ctx: MutationCtx,
  config: Provider.Config,
  connectionPolicy: ReturnType<typeof normalizeGroupConnectionPolicy> | null,
  connection: { groupId: string } | null,
  userId: string,
  profile: AuthProfile,
) {
  if (connectionPolicy?.provisioning.jit.mode !== "createUserAndMembership") return;
  const groupId = connection?.groupId;
  if (!groupId) return;

  const definedRoleIds = new Set(
    Object.keys((config.permissions?.roles ?? {}) as Record<string, unknown>),
  );
  const provisionedRoleIds = resolveProvisionedRoleIds({
    policy: connectionPolicy,
    groups: readStringArrayClaim(profile, "groups"),
    roles: readStringArrayClaim(profile, "roles"),
  }).filter((roleId) => definedRoleIds.has(roleId));

  const existingMembership = single(
    await ctx.runQuery(config.component.group.member.get, { userId, groupId }),
  );
  if (existingMembership === null) {
    await ctx.runMutation(config.component.group.member.create, {
      groupId,
      userId,
      roleIds: provisionedRoleIds,
      status: "active",
    });
  } else if (provisionedRoleIds.length > 0) {
    await ctx.runMutation(config.component.group.member.update, {
      id: existingMembership._id,
      patch: { roleIds: provisionedRoleIds },
    });
  }
}

type OAuthReturnType = string;

/**
 * Provision a user and account from a verified OAuth/Connection profile.
 *
 * Resolves any group connection (OIDC/SAML) and its policy, runs the
 * profile/provision hooks, upserts the user and account, performs JIT
 * membership provisioning, and mints a short-lived single-use sign-in code.
 *
 * @returns The numeric sign-in code the action side exchanges for tokens.
 */
export async function userOAuthImpl(
  ctx: MutationCtx,
  args: Infer<typeof vUserOAuthArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<OAuthReturnType> {
  log("DEBUG", "userOAuthImpl args:", args);
  const { profile, provider, providerAccountId, signature, accountExtend } = args;
  const typedProfile = profile as AuthProfile;
  const db = authDb(ctx, config);
  const connectionId = provider.startsWith(GROUP_OIDC_PROVIDER_PREFIX)
    ? provider.slice(GROUP_OIDC_PROVIDER_PREFIX.length)
    : provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)
      ? provider.slice(GROUP_SAML_PROVIDER_PREFIX.length)
      : null;
  const connectionProtocol = provider.startsWith(GROUP_OIDC_PROVIDER_PREFIX)
    ? "oidc"
    : provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)
      ? "saml"
      : null;

  const existingAccount = await db.accounts.get({ provider, providerAccountId });
  const connection =
    connectionId !== null
      ? await getGroupConnection(ctx, config.component.connection, connectionId)
      : null;
  const group =
    connection !== null ? await getGroup(ctx, config.component.group, connection.groupId) : null;
  const connectionPolicy = connection ? normalizeGroupConnectionPolicy(group?.policy) : null;

  const existingScimIdentity =
    connectionId !== null &&
    existingAccount === null &&
    connectionPolicy?.provisioning.scimReuse.user === "externalId"
      ? single(
          await ctx.runQuery(config.component.connection.scim.identity.get, {
            connectionId,
            resourceType: "user",
            externalId: providerAccountId,
          }),
        )
      : null;

  /**
   * SCIM identity `userId` crosses the component boundary as `string`; re-brand
   * to the server's `Id<"User">` here — the one legitimate cast at the boundary.
   */
  const existingScimUserId = existingScimIdentity?.userId as GenericId<"User"> | undefined;

  let verifier;
  try {
    verifier = await db.verifiers.get({ signature });
  } catch (err) {
    console.error("[auth] OAuth verifier lookup failed", { err });
    throw new ConvexError({
      code: ErrorCode.OAUTH_INVALID_STATE,
      message: "Invalid OAuth state. Please try signing in again.",
    });
  }
  if (verifier === null) {
    throw new ConvexError({
      code: ErrorCode.OAUTH_INVALID_STATE,
      message: "Invalid OAuth state. Please try signing in again.",
    });
  }

  const profileResolved =
    (config.connection?.hooks?.profileResolved
      ? await config.connection.hooks.profileResolved({
          protocol: connectionProtocol ?? "oidc",
          connectionId: connectionId ?? undefined,
          profile: typedProfile,
        })
      : undefined) ?? typedProfile;
  const profileForProvisioning =
    (config.connection?.hooks?.beforeProvision
      ? await config.connection.hooks.beforeProvision({
          protocol: connectionProtocol ?? "oidc",
          connectionId: connectionId ?? undefined,
          profile: profileResolved as Record<string, unknown>,
        })
      : undefined) ?? profileResolved;

  const { accountId } = await upsertUserAndAccount(
    ctx,
    verifier.sessionId ?? null,
    existingAccount !== null ? { existingAccount } : { providerAccountId },
    {
      type: "oauth",
      provider: (isGroupProviderId(provider)
        ? createSyntheticOAuthMaterializedConfig(provider, {
            accountLinking:
              connectionProtocol === "oidc"
                ? connectionPolicy?.identity.accountLinking.oidc
                : connectionProtocol === "saml"
                  ? connectionPolicy?.identity.accountLinking.saml
                  : undefined,
          })
        : getProviderOrThrow(provider)) as AuthProviderMaterializedConfig,
      profile: profileForProvisioning as AuthProfile,
      emails: args.emails,
      accountExtend: normalizeAccountExtend(provider, providerAccountId, accountExtend),
    },
    config,
    connectionPolicy?.provisioning.user
      ? {
          existingUserId: existingScimUserId,
          provisioningUser: connectionPolicy.provisioning.user,
          source: "login",
        }
      : existingScimUserId
        ? { existingUserId: existingScimUserId }
        : undefined,
  );

  if (connectionId !== null) {
    const account = await db.accounts.get({ id: accountId });
    const userId = account?.userId;
    if (userId) {
      await jitProvisionMembership(ctx, config, connectionPolicy, connection, userId, typedProfile);
      if (config.connection?.hooks?.afterProvision) {
        await config.connection.hooks.afterProvision({
          protocol: connectionProtocol ?? "oidc",
          connectionId,
          profile: profileForProvisioning as Record<string, unknown>,
          userId,
        });
      }
    }
  }

  const code = generateRandomString(8, "0123456789");
  await db.verifiers.delete(verifier._id);
  const existingVerificationCode = await db.verificationCodes.get({ accountId });
  if (existingVerificationCode !== null) {
    await db.verificationCodes.delete(existingVerificationCode._id);
  }
  await db.verificationCodes.create({
    code: await sha256(code),
    accountId,
    provider,
    expirationTime: Date.now() + OAUTH_SIGN_IN_EXPIRATION_MS,
    verifier: verifier._id,
  });
  return code;
}

/** Action-side wrapper that runs {@link userOAuthImpl} through the auth store. */
export const callUserOAuth = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof vUserOAuthArgs>,
): Promise<OAuthReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "userOAuth",
      ...args,
    },
  }) as Promise<OAuthReturnType>;
};
