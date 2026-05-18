import {
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  FunctionReference,
} from "convex/server";

type MutationCtxLike = Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">;
type ActionCtxLike = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

type CtxLike = MutationCtxLike | ActionCtxLike;

type AuthComponentApiLike = {
  user: {
    get: FunctionReference<"query", "internal">;
    list: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    upsert: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
    email: {
      list: FunctionReference<"query", "internal">;
      owner: FunctionReference<"query", "internal">;
      upsert: FunctionReference<"mutation", "internal">;
      setPrimary: FunctionReference<"mutation", "internal">;
      delete: FunctionReference<"mutation", "internal">;
    };
  };
  account: {
    get: FunctionReference<"query", "internal">;
    list: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  session: {
    get: FunctionReference<"query", "internal">;
    list: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    issue?: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  token: {
    refresh: {
      get: FunctionReference<"query", "internal">;
      list: FunctionReference<"query", "internal">;
      listChildren: FunctionReference<"query", "internal">;
      create: FunctionReference<"mutation", "internal">;
      update: FunctionReference<"mutation", "internal">;
      delete: FunctionReference<"mutation", "internal">;
      exchange?: FunctionReference<"mutation", "internal">;
    };
    verification: {
      get: FunctionReference<"query", "internal">;
      create: FunctionReference<"mutation", "internal">;
      delete: FunctionReference<"mutation", "internal">;
    };
    pkce: {
      get: FunctionReference<"query", "internal">;
      create: FunctionReference<"mutation", "internal">;
      update: FunctionReference<"mutation", "internal">;
      delete: FunctionReference<"mutation", "internal">;
    };
  };
  rateLimit: {
    get: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
};

/** @internal */
export type AuthDbConfig = { component: AuthComponentApiLike };

/** @internal */
export type AuthDb = ReturnType<typeof authDb>;

/** @internal */
export function authDb(ctx: CtxLike, config: AuthDbConfig) {
  const component = config.component;
  return {
    users: {
      getById: (userId: string) => ctx.runQuery(component.user.get, { id: userId }),
      findByVerifiedEmail: (email: string) =>
        ctx.runQuery(component.user.get, { verifiedEmail: email }),
      findByVerifiedPhone: (phone: string) =>
        ctx.runQuery(component.user.get, { verifiedPhone: phone }),
      insert: (data: Record<string, unknown>) =>
        ctx.runMutation(component.user.create, {
          data,
        }) as Promise<string>,
      patch: (userId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.user.update, { userId, data }),
      upsert: (userId: string | undefined, data: Record<string, unknown>) =>
        ctx.runMutation(component.user.upsert, {
          userId,
          data,
        }) as Promise<string>,
    },
    emails: {
      upsert: (args: {
        userId: string;
        email: string;
        verified?: boolean;
        isPrimary?: boolean;
        source: "password" | "oauth" | "oidc" | "saml" | "scim";
        accountId?: string;
        provider?: string;
        connectionId?: string;
      }) => ctx.runMutation(component.user.email.upsert, args) as Promise<string>,
      listByUser: (userId: string) =>
        ctx.runQuery(component.user.email.list, { userId }),
      findVerified: (email: string, connectionId?: string) =>
        ctx.runQuery(component.user.email.owner, { email, connectionId }),
    },
    accounts: {
      get: (provider: string, providerAccountId: string) =>
        ctx.runQuery(component.account.get, {
          provider,
          providerAccountId,
        }),
      getById: (accountId: string) => ctx.runQuery(component.account.get, { id: accountId }),
      create: (args: {
        userId: string;
        provider: string;
        providerAccountId: string;
        secret?: string;
        extend?: Record<string, unknown>;
      }) => ctx.runMutation(component.account.create, args) as Promise<string>,
      patch: (accountId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.account.update, { accountId, data }),
      delete: (accountId: string) => ctx.runMutation(component.account.delete, { accountId }),
    },
    sessions: {
      create: (userId: string, expirationTime: number) =>
        ctx.runMutation(component.session.create, {
          userId,
          expirationTime,
        }) as Promise<string>,
      issue: (args: {
        userId: string;
        sessionId?: string;
        replaceSessionId?: string;
        sessionExpirationTime: number;
        refreshTokenExpirationTime?: number;
      }) =>
        ctx.runMutation(component.session.issue!, args) as Promise<{
          userId: string;
          sessionId: string;
          refreshTokenId?: string;
        }>,
      getById: (sessionId: string) => ctx.runQuery(component.session.get, { sessionId }),
      delete: (sessionId: string) => ctx.runMutation(component.session.delete, { sessionId }),
      listByUser: (userId: string) => ctx.runQuery(component.session.list, { userId }),
    },
    verifiers: {
      create: (sessionId?: string, signature?: string) =>
        ctx.runMutation(component.token.pkce.create, {
          sessionId,
          signature,
        }) as Promise<string>,
      getById: (verifierId: string) =>
        ctx.runQuery(component.token.pkce.get, { id: verifierId }),
      getBySignature: (signature: string) =>
        ctx.runQuery(component.token.pkce.get, { signature }),
      patch: (verifierId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.token.pkce.update, { verifierId, data }),
      delete: (verifierId: string) =>
        ctx.runMutation(component.token.pkce.delete, { verifierId }),
    },
    verificationCodes: {
      getByAccountId: (accountId: string) =>
        ctx.runQuery(component.token.verification.get, {
          accountId,
        }),
      getByCode: (code: string) =>
        ctx.runQuery(component.token.verification.get, { code }),
      create: (args: {
        accountId: string;
        provider: string;
        code: string;
        expirationTime: number;
        verifier?: string;
        emailVerified?: string;
        phoneVerified?: string;
      }) => ctx.runMutation(component.token.verification.create, args),
      delete: (verificationCodeId: string) =>
        ctx.runMutation(component.token.verification.delete, {
          verificationCodeId,
        }),
    },
    refreshTokens: {
      create: (args: {
        sessionId: string;
        expirationTime: number;
        parentRefreshTokenId?: string;
      }) => ctx.runMutation(component.token.refresh.create, args) as Promise<string>,
      exchange: (args: {
        refreshTokenId: string;
        sessionId: string;
        now: number;
        refreshTokenExpirationTime: number;
        reuseWindowMs: number;
      }) =>
        ctx.runMutation(component.token.refresh.exchange!, args) as Promise<null | {
          userId: string;
          sessionId: string;
          refreshTokenId: string;
        }>,
      getById: (refreshTokenId: string) =>
        ctx.runQuery(component.token.refresh.get, { id: refreshTokenId }),
      patch: (refreshTokenId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.token.refresh.update, {
          refreshTokenId,
          data,
        }),
      getChildren: (sessionId: string, parentRefreshTokenId: string) =>
        ctx.runQuery(component.token.refresh.listChildren, {
          sessionId,
          parentRefreshTokenId,
        }),
      listBySession: (sessionId: string) =>
        ctx.runQuery(component.token.refresh.list, { sessionId }),
      deleteAll: (sessionId: string) =>
        ctx.runMutation(component.token.refresh.delete, { sessionId }),
      getActive: (sessionId: string) =>
        ctx.runQuery(component.token.refresh.get, { activeForSession: sessionId }),
    },
    rateLimits: {
      get: (identifier: string) => ctx.runQuery(component.rateLimit.get, { identifier }),
      create: (args: { identifier: string; attemptsLeft: number; lastAttemptTime: number }) =>
        ctx.runMutation(component.rateLimit.create, args),
      patch: (rateLimitId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.rateLimit.update, { rateLimitId, data }),
      delete: (rateLimitId: string) =>
        ctx.runMutation(component.rateLimit.delete, { rateLimitId }),
    },
  };
}
