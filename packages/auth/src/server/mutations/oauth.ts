import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";
import { Infer, v } from "convex/values";

import { getGroup, getGroupConnection } from "../contract";
import * as Provider from "../crypto";
import { authDb } from "../db";
import { log } from "../log";
import type { AuthAccountExtend, AuthProfile } from "../payloads";
import { accountExtendValidator, payloadRecordValidator } from "../payloads";
import { vProfileEmail } from "../../component/model";
import { generateRandomString, sha256 } from "../random";
import { createSyntheticOAuthMaterializedConfig } from "../sso/oidc";
import { normalizeGroupConnectionPolicy, resolveProvisionedRoleIds } from "../sso/policy";
import {
  GROUP_OIDC_PROVIDER_PREFIX,
  GROUP_SAML_PROVIDER_PREFIX,
  isGroupProviderId,
} from "../sso/shared";
import { MutationCtx } from "../types";
import type { AuthProviderMaterializedConfig } from "../types";
import { upsertUserAndAccount } from "../users";
import { AUTH_STORE_REF } from "./store/refs";

const OAUTH_SIGN_IN_EXPIRATION_MS = 1000 * 60 * 2; // 2 minutes

export const userOAuthArgs = v.object({
  provider: v.string(),
  providerAccountId: v.string(),
  profile: payloadRecordValidator,
  emails: v.optional(v.array(vProfileEmail)),
  signature: v.string(),
  accountExtend: v.optional(accountExtendValidator),
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

  const provisionedRoleIds = resolveProvisionedRoleIds({
    policy: connectionPolicy,
    groups: Array.isArray((profile as Record<string, unknown>).groups)
      ? ((profile as Record<string, unknown>).groups as string[])
      : undefined,
    roles: Array.isArray((profile as Record<string, unknown>).roles)
      ? ((profile as Record<string, unknown>).roles as string[])
      : undefined,
  });

  const existingMembership = await ctx.runQuery(
    config.component.group.member.get,
    { userId, groupId },
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
      memberId: existingMembership._id,
      data: { roleIds: provisionedRoleIds },
    });
  }
}

type OAuthReturnType = string;

export async function userOAuthImpl(
  ctx: MutationCtx,
  args: Infer<typeof userOAuthArgs>,
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

  const existingAccount = await db.accounts.get(provider, providerAccountId);
  const connection =
    connectionId !== null
      ? await getGroupConnection(ctx, config.component.sso, connectionId)
      : null;
  const group =
    connection !== null ? await getGroup(ctx, config.component.group, connection.groupId) : null;
  const connectionPolicy = connection ? normalizeGroupConnectionPolicy(group?.policy) : null;

  const existingScimIdentity =
    connectionId !== null &&
    existingAccount === null &&
    connectionPolicy?.provisioning.scimReuse.user === "externalId"
      ? await ctx.runQuery(config.component.sso.connection.scim.identity.get, {
          connectionId,
          resourceType: "user",
          externalId: providerAccountId,
        })
      : null;

  let verifier;
  try {
    verifier = await db.verifiers.getBySignature(signature);
  } catch {
    throw new ConvexError({
      code: "OAUTH_INVALID_STATE",
      message: "Invalid OAuth state. Please try signing in again.",
    });
  }
  if (verifier === null) {
    throw new ConvexError({
      code: "OAUTH_INVALID_STATE",
      message: "Invalid OAuth state. Please try signing in again.",
    });
  }

  const profileResolved =
    (config.sso?.hooks?.profileResolved
      ? await config.sso.hooks.profileResolved({
          protocol: connectionProtocol ?? "oidc",
          connectionId: connectionId ?? undefined,
          profile: typedProfile,
        })
      : undefined) ?? typedProfile;
  const profileForProvisioning =
    (config.sso?.hooks?.beforeProvision
      ? await config.sso.hooks.beforeProvision({
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
          existingUserId: existingScimIdentity?.userId,
          provisioningUser: connectionPolicy.provisioning.user,
          source: "login",
        }
      : existingScimIdentity?.userId
        ? { existingUserId: existingScimIdentity.userId }
        : undefined,
  );

  if (connectionId !== null) {
    const account = await db.accounts.getById(accountId);
    const userId = account?.userId;
    if (userId) {
      await jitProvisionMembership(ctx, config, connectionPolicy, connection, userId, typedProfile);
      if (config.sso?.hooks?.afterProvision) {
        await config.sso.hooks.afterProvision({
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
  const existingVerificationCode = await db.verificationCodes.getByAccountId(accountId);
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

export const callUserOAuth = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof userOAuthArgs>,
): Promise<OAuthReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "userOAuth",
      ...args,
    },
  }) as Promise<OAuthReturnType>;
};
