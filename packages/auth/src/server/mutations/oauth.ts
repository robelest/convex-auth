import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../authError";
import * as Provider from "../crypto";
import {
  createSyntheticOAuthMaterializedConfig,
} from "../enterprise/oidc";
import { normalizeEnterprisePolicy } from "../enterprise/policy";
import {
  ENTERPRISE_OIDC_PROVIDER_PREFIX,
  ENTERPRISE_SAML_PROVIDER_PREFIX,
  isEnterpriseProviderId,
} from "../enterprise/shared";
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
  if (provider.startsWith(ENTERPRISE_OIDC_PROVIDER_PREFIX)) {
    baseIdentity.type = "enterprise-oidc";
    baseIdentity.enterpriseId = provider.slice(
      ENTERPRISE_OIDC_PROVIDER_PREFIX.length,
    );
  }
  if (provider.startsWith(ENTERPRISE_SAML_PROVIDER_PREFIX)) {
    baseIdentity.type = "enterprise-saml";
    baseIdentity.enterpriseId = provider.slice(
      ENTERPRISE_SAML_PROVIDER_PREFIX.length,
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
): Fx<ReturnType, AuthError> {
  return Fx.gen(function* () {
    logWithLevel("DEBUG", "userOAuthImpl args:", args);
    const { profile, provider, providerAccountId, signature, accountExtend } =
      args;
    const db = authDb(ctx, config);
    const existingAccount = yield* Fx.promise(() =>
      db.accounts.get(provider, providerAccountId),
    );
    const enterpriseId = provider.startsWith(ENTERPRISE_OIDC_PROVIDER_PREFIX)
      ? provider.slice(ENTERPRISE_OIDC_PROVIDER_PREFIX.length)
      : provider.startsWith(ENTERPRISE_SAML_PROVIDER_PREFIX)
        ? provider.slice(ENTERPRISE_SAML_PROVIDER_PREFIX.length)
        : null;
    const enterprise =
      enterpriseId !== null
        ? yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.enterpriseGet, {
              enterpriseId,
            }),
          )
        : null;
    const enterprisePolicy = enterprise
      ? normalizeEnterprisePolicy(enterprise.policy)
      : null;
    const enterpriseProtocol = provider.startsWith(
      ENTERPRISE_OIDC_PROVIDER_PREFIX,
    )
      ? "oidc"
      : provider.startsWith(ENTERPRISE_SAML_PROVIDER_PREFIX)
        ? "saml"
        : null;

    const existingScimIdentity =
      enterpriseId !== null &&
      existingAccount === null &&
      enterprisePolicy?.provisioning.scimReuse.user === "externalId"
        ? yield* Fx.promise(() =>
            ctx.runQuery(config.component.public.enterpriseScimIdentityGet, {
              enterpriseId,
              resourceType: "user",
              externalId: providerAccountId,
            }),
          )
        : null;

    const verifier = yield* Fx.from({
      ok: () => db.verifiers.getBySignature(signature),
      err: () => new AuthError("OAUTH_INVALID_STATE"),
    }).pipe(
      Fx.chain((doc) =>
        doc === null
          ? Fx.fail(new AuthError("OAUTH_INVALID_STATE"))
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
          provider: (isEnterpriseProviderId(provider)
            ? createSyntheticOAuthMaterializedConfig(provider, {
                accountLinking:
                  enterpriseProtocol === "oidc"
                    ? enterprisePolicy?.identity.accountLinking.oidc
                    : enterpriseProtocol === "saml"
                      ? enterprisePolicy?.identity.accountLinking.saml
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

    // JIT group provisioning: if this is an enterprise SSO sign-in and the
    // enterprise connection has a groupId, auto-add the user as a member of
    // that group if they aren't already a member.
    if (
      enterpriseId !== null &&
      enterprisePolicy?.provisioning.jit.mode === "createUserAndMembership"
    ) {
      const account = yield* Fx.promise(() => db.accounts.getById(accountId));
      const userId = account?.userId;
      if (userId) {
        const groupId = (enterprise as any)?.groupId as string | undefined;
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
                roleIds: enterprisePolicy.provisioning.jit.defaultRoleIds,
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
