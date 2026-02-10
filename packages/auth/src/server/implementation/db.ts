import { GenericActionCtx, GenericDataModel, GenericMutationCtx } from "convex/server";
import { AuthComponentApi } from "../types.js";

type MutationCtxLike = Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">;
type ActionCtxLike = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

type CtxLike = MutationCtxLike | ActionCtxLike;

export type AuthDb = ReturnType<typeof createAuthDb>;

export function createAuthDb(ctx: CtxLike, component: AuthComponentApi) {
  return {
    users: {
      getById: (userId: string) =>
        ctx.runQuery(component.public.userGetById, { userId }),
      findByVerifiedEmail: (email: string) =>
        ctx.runQuery(component.public.userFindByVerifiedEmail, { email }),
      findByVerifiedPhone: (phone: string) =>
        ctx.runQuery(component.public.userFindByVerifiedPhone, { phone }),
      insert: (data: Record<string, unknown>) =>
        ctx.runMutation(component.public.userInsert, { data }) as Promise<string>,
      patch: (userId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.userPatch, { userId, data }),
      upsert: (userId: string | undefined, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.userUpsert, { userId, data }) as Promise<string>,
    },
    accounts: {
      get: (provider: string, providerAccountId: string) =>
        ctx.runQuery(component.public.accountGet, { provider, providerAccountId }),
      getById: (accountId: string) =>
        ctx.runQuery(component.public.accountGetById, { accountId }),
      create: (args: {
        userId: string;
        provider: string;
        providerAccountId: string;
        secret?: string;
      }) => ctx.runMutation(component.public.accountInsert, args) as Promise<string>,
      patch: (accountId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.accountPatch, { accountId, data }),
      delete: (accountId: string) =>
        ctx.runMutation(component.public.accountDelete, { accountId }),
    },
    sessions: {
      create: (userId: string, expirationTime: number) =>
        ctx.runMutation(component.public.sessionCreate, { userId, expirationTime }) as Promise<string>,
      getById: (sessionId: string) =>
        ctx.runQuery(component.public.sessionGetById, { sessionId }),
      delete: (sessionId: string) =>
        ctx.runMutation(component.public.sessionDelete, { sessionId }),
      listByUser: (userId: string) =>
        ctx.runQuery(component.public.sessionListByUser, { userId }),
    },
    verifiers: {
      create: (sessionId?: string) =>
        ctx.runMutation(component.public.verifierCreate, { sessionId }) as Promise<string>,
      getById: (verifierId: string) =>
        ctx.runQuery(component.public.verifierGetById, { verifierId }),
      getBySignature: (signature: string) =>
        ctx.runQuery(component.public.verifierGetBySignature, { signature }),
      patch: (verifierId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.verifierPatch, { verifierId, data }),
      delete: (verifierId: string) =>
        ctx.runMutation(component.public.verifierDelete, { verifierId }),
    },
    verificationCodes: {
      getByAccountId: (accountId: string) =>
        ctx.runQuery(component.public.verificationCodeGetByAccountId, { accountId }),
      getByCode: (code: string) =>
        ctx.runQuery(component.public.verificationCodeGetByCode, { code }),
      create: (args: {
        accountId: string;
        provider: string;
        code: string;
        expirationTime: number;
        verifier?: string;
        emailVerified?: string;
        phoneVerified?: string;
      }) =>
        ctx.runMutation(component.public.verificationCodeCreate, args),
      delete: (verificationCodeId: string) =>
        ctx.runMutation(component.public.verificationCodeDelete, {
          verificationCodeId,
        }),
    },
    refreshTokens: {
      create: (args: {
        sessionId: string;
        expirationTime: number;
        parentRefreshTokenId?: string;
      }) =>
        ctx.runMutation(component.public.refreshTokenCreate, args) as Promise<string>,
      getById: (refreshTokenId: string) =>
        ctx.runQuery(component.public.refreshTokenGetById, { refreshTokenId }),
      patch: (refreshTokenId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.refreshTokenPatch, { refreshTokenId, data }),
      getChildren: (sessionId: string, parentRefreshTokenId: string) =>
        ctx.runQuery(component.public.refreshTokenGetChildren, {
          sessionId,
          parentRefreshTokenId,
        }),
      listBySession: (sessionId: string) =>
        ctx.runQuery(component.public.refreshTokenListBySession, { sessionId }),
      deleteAll: (sessionId: string) =>
        ctx.runMutation(component.public.refreshTokenDeleteAll, { sessionId }),
      getActive: (sessionId: string) =>
        ctx.runQuery(component.public.refreshTokenGetActive, { sessionId }),
    },
    rateLimits: {
      get: (identifier: string) =>
        ctx.runQuery(component.public.rateLimitGet, { identifier }),
      create: (args: {
        identifier: string;
        attemptsLeft: number;
        lastAttemptTime: number;
      }) => ctx.runMutation(component.public.rateLimitCreate, args),
      patch: (rateLimitId: string, data: Record<string, unknown>) =>
        ctx.runMutation(component.public.rateLimitPatch, { rateLimitId, data }),
      delete: (rateLimitId: string) =>
        ctx.runMutation(component.public.rateLimitDelete, { rateLimitId }),
    },
  };
}
