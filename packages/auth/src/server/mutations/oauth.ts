import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ConvexError } from "convex/values";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { createSyntheticOAuthMaterializedConfig } from "../sso/oidc";
import { normalizeGroupConnectionPolicy } from "../sso/policy";
import {
  GROUP_OIDC_PROVIDER_PREFIX,
  GROUP_SAML_PROVIDER_PREFIX,
  isGroupProviderId,
} from "../sso/shared";
import { MutationCtx } from "../types";
import type { AuthProviderMaterializedConfig } from "../types";
import { upsertUserAndAccount } from "../users";
import { generateRandomString, logWithLevel, sha256 } from "../utils";
import { AUTH_STORE_REF } from "./store/refs";

const OAUTH_SIGN_IN_EXPIRATION_MS = 1000 * 60 * 2; // 2 minutes

export const userOAuthArgs = v.object({
  provider: v.string(),
  providerAccountId: v.string(),
  profile: v.any(),
  signature: v.string(),
  accountExtend: v.optional(v.any()),
});

function normalizeAccountExtend(
  provider: string,
  providerAccountId: string,
  accountExtend: unknown,
) {
  const baseIdentity: Record<string, unknown> = {
    type: "oauth",
    provider,
    providerAccountId,
  };
  if (provider.startsWith(GROUP_OIDC_PROVIDER_PREFIX)) {
    baseIdentity.type = "group-connection-oidc";
    baseIdentity.connectionId = provider.slice(
      GROUP_OIDC_PROVIDER_PREFIX.length,
    );
  }
  if (provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)) {
    baseIdentity.type = "group-connection-saml";
    baseIdentity.connectionId = provider.slice(
      GROUP_SAML_PROVIDER_PREFIX.length,
    );
  }
  const provided =
    typeof accountExtend === "object" &&
    accountExtend !== null &&
    !Array.isArray(accountExtend)
      ? (accountExtend as Record<string, unknown>)
      : undefined;
  const providedIdentity =
    provided &&
    typeof provided.identity === "object" &&
    provided.identity !== null &&
    !Array.isArray(provided.identity)
      ? (provided.identity as Record<string, unknown>)
      : undefined;
  return {
    ...provided,
    identity: {
      ...baseIdentity,
      ...providedIdentity,
    },
  };
}

type ReturnType = string;

export function userOAuthImpl(
  ctx: MutationCtx,
  args: Infer<typeof userOAuthArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Fx<ReturnType, ConvexError<{ code: string; message: string }>> {
  return Fx.gen(function* () {
    logWithLevel("DEBUG", "userOAuthImpl args:", args);
    const { profile, provider, providerAccountId, signature, accountExtend } =
      args;
    const db = authDb(ctx, config);
    const existingAccount = yield* Fx.promise(() =>
      db.accounts.get(provider, providerAccountId),
    );
    const connectionId = provider.startsWith(GROUP_OIDC_PROVIDER_PREFIX)
      ? provider.slice(GROUP_OIDC_PROVIDER_PREFIX.length)
      : provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)
        ? provider.slice(GROUP_SAML_PROVIDER_PREFIX.length)
        : null;
    const connection =
      connectionId !== null
        ? yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.groupConnectionGet, {
              connectionId,
            }),
          )
        : null;
    const group =
      connection !== null
        ? yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.groupGet, {
              groupId: connection.groupId,
            }),
          )
        : null;
    const connectionPolicy = connection
      ? normalizeGroupConnectionPolicy(group?.policy)
      : null;
    const connectionProtocol = provider.startsWith(
      GROUP_OIDC_PROVIDER_PREFIX,
    )
      ? "oidc"
      : provider.startsWith(GROUP_SAML_PROVIDER_PREFIX)
        ? "saml"
        : null;

    const existingScimIdentity =
      connectionId !== null &&
      existingAccount === null &&
      connectionPolicy?.provisioning.scimReuse.user === "externalId"
        ? yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.groupConnectionScimIdentityGet, {
              connectionId,
              resourceType: "user",
              externalId: providerAccountId,
            }),
          )
        : null;

    const verifier = yield* Fx.from({
      ok: () => db.verifiers.getBySignature(signature),
      err: () =>
        Cv.error({
          code: "OAUTH_INVALID_STATE",
          message: "Invalid OAuth state. Please try signing in again.",
        }),
    }).pipe(
      Fx.chain((doc) =>
        doc === null
          ? Cv.fail({
              code: "OAUTH_INVALID_STATE",
              message: "Invalid OAuth state. Please try signing in again.",
            })
          : Fx.succeed(doc),
      ),
    );

    const { accountId } = yield* Fx.promise(() =>
      upsertUserAndAccount(
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
          profile,
          accountExtend: normalizeAccountExtend(
            provider,
            providerAccountId,
            accountExtend,
          ),
        },
        config,
        existingScimIdentity?.userId
          ? { existingUserId: existingScimIdentity.userId }
          : undefined,
      ),
    );

    // JIT group provisioning: if this is an group SSO sign-in and the
    // group connection has a groupId, auto-add the user as a member of
    // that group if they aren't already a member.
    if (
      connectionId !== null &&
      connectionPolicy?.provisioning.jit.mode === "createUserAndMembership"
    ) {
      const account = yield* Fx.promise(() => db.accounts.getById(accountId));
      const userId = account?.userId;
      if (userId) {
        const groupId = (connection as any)?.groupId as string | undefined;
        if (groupId) {
          const existingMembership = yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.memberGetByGroupAndUser, {
              userId,
              groupId,
            }),
          );
          if (existingMembership === null) {
            yield* Fx.promise(() =>
              ctx.runMutation(config.component.public.memberAdd, {
                groupId,
                userId,
                roleIds: connectionPolicy.provisioning.jit.defaultRoleIds,
                status: "active",
              }),
            );
          }
        }
      }
    }

    const code = generateRandomString(8, "0123456789");
    yield* Fx.promise(() => db.verifiers.delete(verifier._id));
    const existingVerificationCode = yield* Fx.promise(() =>
      db.verificationCodes.getByAccountId(accountId),
    );
    if (existingVerificationCode !== null) {
      yield* Fx.promise(() =>
        db.verificationCodes.delete(existingVerificationCode._id),
      );
    }
    yield* Fx.promise(async () =>
      db.verificationCodes.create({
        code: await sha256(code),
        accountId,
        provider,
        expirationTime: Date.now() + OAUTH_SIGN_IN_EXPIRATION_MS,
        verifier: verifier._id,
      }),
    );
    return code;
  });
}

export const callUserOAuth = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof userOAuthArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "userOAuth",
      ...args,
    },
  });
};
