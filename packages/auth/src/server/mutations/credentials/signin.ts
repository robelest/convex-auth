/**
 * Combined credentials-verify + session-issue mutation. Replaces the
 * separate `retrieveAccountWithCredentials` + `signIn` pair so password
 * sign-in pays one cross-component RPC instead of two.
 *
 * @internal
 */

import type { GenericDataModel } from "convex/server";
import { Infer, v } from "convex/values";

import * as Provider from "../../crypto";
import { authDb } from "../../db";
import {
  getSignInRateLimitState,
  isStateRateLimited,
  recordFailedSignIn,
  resetSignInRateLimit,
} from "../../limits";
import { LOG_LEVELS, log, maybeRedact } from "../../log";
import { issueSession } from "../../sessions";
import type { SessionIssuance } from "../../sessions";
import { Doc, GenericActionCtxWithAuthConfig, MutationCtx } from "../../types";
import { withSpan } from "../../utils/span";
import { AUTH_STORE_REF } from "../store/refs";

export const credentialsSignInArgs = v.object({
  provider: v.string(),
  account: v.object({ id: v.string(), secret: v.string() }),
  generateTokens: v.boolean(),
  requireVerifiedEmail: v.boolean(),
  enforceTotp: v.boolean(),
});

type CredentialsSignInResult =
  | { kind: "invalidAccount" }
  | { kind: "tooManyAttempts" }
  | { kind: "invalidSecret" }
  | {
      kind: "emailVerificationRequired";
      account: { _id: string; emailVerified?: string };
      user: {
        _id: string;
        email?: string;
      };
    }
  | {
      kind: "signedIn";
      issuance: SessionIssuance;
      account: { _id: string; emailVerified?: string };
      user: {
        _id: string;
        email?: string;
        hasTotp?: boolean;
      };
    }
  | {
      kind: "totpRequired";
      issuance: SessionIssuance; // issued with generateTokens=false
      account: { _id: string; emailVerified?: string };
      user: { _id: string; email?: string };
    };

export async function credentialsSignInImpl(
  ctx: MutationCtx,
  args: Infer<typeof credentialsSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<CredentialsSignInResult> {
  return withSpan(
    "convex-auth.mutations.credentialsSignIn",
    { provider: args.provider, generateTokens: args.generateTokens },
    () => credentialsSignInInner(ctx, args, getProviderOrThrow, config),
  );
}

async function credentialsSignInInner(
  ctx: MutationCtx,
  args: Infer<typeof credentialsSignInArgs>,
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
): Promise<CredentialsSignInResult> {
  const { provider: providerId, account, generateTokens, requireVerifiedEmail, enforceTotp } = args;
  const db = authDb(ctx, config);

  log(LOG_LEVELS.DEBUG, "credentialsSignInImpl args:", {
    provider: providerId,
    account: { id: account.id, secret: maybeRedact(account.secret) },
    generateTokens,
    requireVerifiedEmail,
    enforceTotp,
  });

  const existingAccount = (await db.accounts.get(providerId, account.id)) as Doc<"Account"> | null;
  if (existingAccount === null) {
    return { kind: "invalidAccount" };
  }

  // User fetch and rate-limit state read in parallel; neither depends on
  // the other.
  const [user, rateLimitState] = await Promise.all([
    db.users.getById(existingAccount.userId) as Promise<Doc<"User"> | null>,
    getSignInRateLimitState(ctx, existingAccount._id, config),
  ]);

  if (user === null) {
    log(
      LOG_LEVELS.ERROR,
      `Account ${existingAccount._id} links to missing user ${existingAccount.userId}`,
    );
    return { kind: "invalidAccount" };
  }

  if (isStateRateLimited(rateLimitState)) {
    return { kind: "tooManyAttempts" };
  }

  const verified = await withSpan("convex-auth.credentials.verify", { providerId }, () =>
    Provider.verify(getProviderOrThrow(providerId), account.secret, existingAccount.secret ?? ""),
  );
  if (!verified) {
    await recordFailedSignIn(ctx, existingAccount._id, config, rateLimitState);
    return { kind: "invalidSecret" };
  }

  if (requireVerifiedEmail && !existingAccount.emailVerified) {
    await resetSignInRateLimit(ctx, existingAccount._id, config, rateLimitState);
    return {
      kind: "emailVerificationRequired",
      account: {
        _id: existingAccount._id,
        emailVerified: existingAccount.emailVerified,
      },
      user: {
        _id: user._id,
        email: user.email,
      },
    };
  }

  let hasTotp = user.hasTotp;
  if (enforceTotp && hasTotp === undefined) {
    const memberResolveRef = (config.component.public as Record<string, unknown>)[
      "totpGetVerifiedByUserId"
    ];
    const totpDoc = (await (
      ctx.runQuery as unknown as (ref: unknown, args: Record<string, unknown>) => Promise<unknown>
    )(memberResolveRef, {
      userId: existingAccount.userId,
    })) as { _id: string } | null;
    hasTotp = totpDoc !== null;
    await db.users.patch(existingAccount.userId, { hasTotp });
  }

  const totpRequired = enforceTotp && hasTotp === true;

  const [issuance] = await Promise.all([
    issueSession(ctx, config, {
      userId: existingAccount.userId,
      generateTokens: generateTokens && !totpRequired,
    }),
    resetSignInRateLimit(ctx, existingAccount._id, config, rateLimitState),
  ]);

  if (totpRequired) {
    return {
      kind: "totpRequired",
      issuance,
      account: {
        _id: existingAccount._id,
        emailVerified: existingAccount.emailVerified,
      },
      user: { _id: user._id, email: user.email },
    };
  }

  return {
    kind: "signedIn",
    issuance,
    account: {
      _id: existingAccount._id,
      emailVerified: existingAccount.emailVerified,
    },
    user: {
      _id: user._id,
      email: user.email,
      hasTotp,
    },
  };
}

/** @internal */
export const callCredentialsSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof credentialsSignInArgs>,
): Promise<CredentialsSignInResult> => {
  return (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "credentialsSignIn",
      ...args,
    },
  })) as CredentialsSignInResult;
};
