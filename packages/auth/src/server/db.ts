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
      findOwner: FunctionReference<"query", "internal">;
      upsert: FunctionReference<"mutation", "internal">;
      setPrimary: FunctionReference<"mutation", "internal">;
      delete: FunctionReference<"mutation", "internal">;
    };
  };
  account: {
    get: FunctionReference<"query", "internal">;
    listByUser: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  session: {
    get: FunctionReference<"query", "internal">;
    listByUser: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    issue?: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  verificationCode: {
    get: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  refreshToken: {
    get: FunctionReference<"query", "internal">;
    list: FunctionReference<"query", "internal">;
    listChildren: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
    exchange?: FunctionReference<"mutation", "internal">;
  };
  verifier: {
    get: FunctionReference<"query", "internal">;
    create: FunctionReference<"mutation", "internal">;
    update: FunctionReference<"mutation", "internal">;
    delete: FunctionReference<"mutation", "internal">;
  };
  public: {
    rateLimitGet: FunctionReference<"query", "internal">;
    rateLimitCreate: FunctionReference<"mutation", "internal">;
    rateLimitPatch: FunctionReference<"mutation", "internal">;
    rateLimitDelete: FunctionReference<"mutation", "internal">;
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
        ctx.runQuery(component.user.email.findOwner, { email, connectionId }),
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
      listByUser: (userId: string) => ctx.runQuery(component.session.listByUser, { userId }),
    },
    verifiers: {
      create: (sessionId?: string, signature?: string) =>
        ctx.runMutation(component.verifier.create, {
          sessionId,
          signature,
        }) as Promise<string>,
      getById: (verifierId: string) =>
        ctx.runQuery(component.verifier.get, { id: verifierId }),
      getBySignature: (signature: string) =>
        ctx.runQuery(component.verifier.get, { signature }),
      patch: (verifierId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.verifier.update, { verifierId, data }),
      delete: (verifierId: string) =>
        ctx.runMutation(component.verifier.delete, { verifierId }),
    },
    verificationCodes: {
      getByAccountId: (accountId: string) =>
        ctx.runQuery(component.verificationCode.get, {
          accountId,
        }),
      getByCode: (code: string) =>
        ctx.runQuery(component.verificationCode.get, { code }),
      create: (args: {
        accountId: string;
        provider: string;
        code: string;
        expirationTime: number;
        verifier?: string;
        emailVerified?: string;
        phoneVerified?: string;
      }) => ctx.runMutation(component.verificationCode.create, args),
      delete: (verificationCodeId: string) =>
        ctx.runMutation(component.verificationCode.delete, {
          verificationCodeId,
        }),
    },
    refreshTokens: {
      create: (args: {
        sessionId: string;
        expirationTime: number;
        parentRefreshTokenId?: string;
      }) => ctx.runMutation(component.refreshToken.create, args) as Promise<string>,
      exchange: (args: {
        refreshTokenId: string;
        sessionId: string;
        now: number;
        refreshTokenExpirationTime: number;
        reuseWindowMs: number;
      }) =>
        ctx.runMutation(component.refreshToken.exchange!, args) as Promise<null | {
          userId: string;
          sessionId: string;
          refreshTokenId: string;
        }>,
      getById: (refreshTokenId: string) =>
        ctx.runQuery(component.refreshToken.get, { id: refreshTokenId }),
      patch: (refreshTokenId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.refreshToken.update, {
          refreshTokenId,
          data,
        }),
      getChildren: (sessionId: string, parentRefreshTokenId: string) =>
        ctx.runQuery(component.refreshToken.listChildren, {
          sessionId,
          parentRefreshTokenId,
        }),
      listBySession: (sessionId: string) =>
        ctx.runQuery(component.refreshToken.list, { sessionId }),
      deleteAll: (sessionId: string) =>
        ctx.runMutation(component.refreshToken.delete, { sessionId }),
      getActive: (sessionId: string) =>
        ctx.runQuery(component.refreshToken.get, { activeForSession: sessionId }),
    },
    rateLimits: {
      get: (identifier: string) => ctx.runQuery(component.public.rateLimitGet, { identifier }),
      create: (args: { identifier: string; attemptsLeft: number; lastAttemptTime: number }) =>
        ctx.runMutation(component.public.rateLimitCreate, args),
      patch: (rateLimitId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.rateLimitPatch, { rateLimitId, data }),
      delete: (rateLimitId: string) =>
        ctx.runMutation(component.public.rateLimitDelete, { rateLimitId }),
    },
  };
}
