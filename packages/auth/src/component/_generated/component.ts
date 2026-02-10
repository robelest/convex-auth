/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    public: {
      accountDelete: FunctionReference<
        "mutation",
        "internal",
        { accountId: string },
        any,
        Name
      >;
      accountGet: FunctionReference<
        "query",
        "internal",
        { provider: string; providerAccountId: string },
        any,
        Name
      >;
      accountGetById: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        any,
        Name
      >;
      accountInsert: FunctionReference<
        "mutation",
        "internal",
        {
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        },
        any,
        Name
      >;
      accountPatch: FunctionReference<
        "mutation",
        "internal",
        { accountId: string; data: any },
        any,
        Name
      >;
      inviteAccept: FunctionReference<
        "mutation",
        "internal",
        { inviteId: string },
        any,
        Name
      >;
      inviteCreate: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        any,
        Name
      >;
      inviteGet: FunctionReference<
        "query",
        "internal",
        { inviteId: string },
        any,
        Name
      >;
      inviteList: FunctionReference<
        "query",
        "internal",
        { organizationId?: string; status?: string },
        any,
        Name
      >;
      inviteRevoke: FunctionReference<
        "mutation",
        "internal",
        { inviteId: string },
        any,
        Name
      >;
      limitCreate: FunctionReference<
        "mutation",
        "internal",
        { attemptsLeft: number; identifier: string; lastAttemptTime: number },
        any,
        Name
      >;
      limitDelete: FunctionReference<
        "mutation",
        "internal",
        { rateLimitId: string },
        any,
        Name
      >;
      limitGet: FunctionReference<
        "query",
        "internal",
        { identifier: string },
        any,
        Name
      >;
      limitPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; rateLimitId: string },
        any,
        Name
      >;
      memberAdd: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        any,
        Name
      >;
      memberList: FunctionReference<
        "query",
        "internal",
        { organizationId: string; teamId?: string },
        any,
        Name
      >;
      memberRemove: FunctionReference<
        "mutation",
        "internal",
        { memberId: string },
        any,
        Name
      >;
      memberRoleGet: FunctionReference<
        "query",
        "internal",
        { memberId: string },
        any,
        Name
      >;
      memberRoleSet: FunctionReference<
        "mutation",
        "internal",
        { memberId: string; role: string },
        any,
        Name
      >;
      organizationCreate: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        any,
        Name
      >;
      organizationDelete: FunctionReference<
        "mutation",
        "internal",
        { organizationId: string },
        any,
        Name
      >;
      organizationGet: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        any,
        Name
      >;
      organizationList: FunctionReference<
        "query",
        "internal",
        { ownerUserId?: string },
        any,
        Name
      >;
      organizationUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; organizationId: string },
        any,
        Name
      >;
      rateLimitCreate: FunctionReference<
        "mutation",
        "internal",
        { attemptsLeft: number; identifier: string; lastAttemptTime: number },
        any,
        Name
      >;
      rateLimitDelete: FunctionReference<
        "mutation",
        "internal",
        { rateLimitId: string },
        any,
        Name
      >;
      rateLimitGet: FunctionReference<
        "query",
        "internal",
        { identifier: string },
        any,
        Name
      >;
      rateLimitPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; rateLimitId: string },
        any,
        Name
      >;
      refreshTokenCreate: FunctionReference<
        "mutation",
        "internal",
        {
          expirationTime: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        },
        any,
        Name
      >;
      refreshTokenDeleteAll: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      refreshTokenGetActive: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      refreshTokenGetById: FunctionReference<
        "query",
        "internal",
        { refreshTokenId: string },
        any,
        Name
      >;
      refreshTokenGetChildren: FunctionReference<
        "query",
        "internal",
        { parentRefreshTokenId: string; sessionId: string },
        any,
        Name
      >;
      refreshTokenListBySession: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      refreshTokenPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; refreshTokenId: string },
        any,
        Name
      >;
      sessionCreate: FunctionReference<
        "mutation",
        "internal",
        { expirationTime: number; userId: string },
        any,
        Name
      >;
      sessionDelete: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      sessionGetById: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      sessionListByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      teamCreate: FunctionReference<
        "mutation",
        "internal",
        {
          metadata?: any;
          name: string;
          organizationId: string;
          parentTeamId?: string;
          slug?: string;
        },
        any,
        Name
      >;
      teamDelete: FunctionReference<
        "mutation",
        "internal",
        { teamId: string },
        any,
        Name
      >;
      teamGet: FunctionReference<
        "query",
        "internal",
        { teamId: string },
        any,
        Name
      >;
      teamListByOrganization: FunctionReference<
        "query",
        "internal",
        { organizationId: string },
        any,
        Name
      >;
      teamRelationCreate: FunctionReference<
        "mutation",
        "internal",
        {
          childTeamId: string;
          organizationId: string;
          parentTeamId: string;
          relation?: string;
        },
        any,
        Name
      >;
      teamRelationDelete: FunctionReference<
        "mutation",
        "internal",
        { teamRelationId: string },
        any,
        Name
      >;
      teamRelationGet: FunctionReference<
        "query",
        "internal",
        { teamRelationId: string },
        any,
        Name
      >;
      teamRelationListByParent: FunctionReference<
        "query",
        "internal",
        { organizationId: string; parentTeamId: string },
        any,
        Name
      >;
      teamUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; teamId: string },
        any,
        Name
      >;
      tokenCreate: FunctionReference<
        "mutation",
        "internal",
        {
          expirationTime: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        },
        any,
        Name
      >;
      tokenDeleteAll: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      tokenGetActive: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      tokenGetById: FunctionReference<
        "query",
        "internal",
        { refreshTokenId: string },
        any,
        Name
      >;
      tokenGetChildren: FunctionReference<
        "query",
        "internal",
        { parentRefreshTokenId: string; sessionId: string },
        any,
        Name
      >;
      tokenListBySession: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        any,
        Name
      >;
      tokenPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; refreshTokenId: string },
        any,
        Name
      >;
      userFindByVerifiedEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        any,
        Name
      >;
      userFindByVerifiedPhone: FunctionReference<
        "query",
        "internal",
        { phone: string },
        any,
        Name
      >;
      userGetById: FunctionReference<
        "query",
        "internal",
        { userId: string },
        any,
        Name
      >;
      userInsert: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        any,
        Name
      >;
      userPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId: string },
        any,
        Name
      >;
      userUpsert: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId?: string },
        any,
        Name
      >;
      verificationCodeCreate: FunctionReference<
        "mutation",
        "internal",
        {
          accountId: string;
          code: string;
          emailVerified?: string;
          expirationTime: number;
          phoneVerified?: string;
          provider: string;
          verifier?: string;
        },
        any,
        Name
      >;
      verificationCodeDelete: FunctionReference<
        "mutation",
        "internal",
        { verificationCodeId: string },
        any,
        Name
      >;
      verificationCodeGetByAccountId: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        any,
        Name
      >;
      verificationCodeGetByCode: FunctionReference<
        "query",
        "internal",
        { code: string },
        any,
        Name
      >;
      verificationCreate: FunctionReference<
        "mutation",
        "internal",
        {
          accountId: string;
          code: string;
          emailVerified?: string;
          expirationTime: number;
          phoneVerified?: string;
          provider: string;
          verifier?: string;
        },
        any,
        Name
      >;
      verificationDelete: FunctionReference<
        "mutation",
        "internal",
        { verificationCodeId: string },
        any,
        Name
      >;
      verificationGetByAccountId: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        any,
        Name
      >;
      verificationGetByCode: FunctionReference<
        "query",
        "internal",
        { code: string },
        any,
        Name
      >;
      verifierCreate: FunctionReference<
        "mutation",
        "internal",
        { sessionId?: string },
        any,
        Name
      >;
      verifierDelete: FunctionReference<
        "mutation",
        "internal",
        { verifierId: string },
        any,
        Name
      >;
      verifierGetById: FunctionReference<
        "query",
        "internal",
        { verifierId: string },
        any,
        Name
      >;
      verifierGetBySignature: FunctionReference<
        "query",
        "internal",
        { signature: string },
        any,
        Name
      >;
      verifierPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; verifierId: string },
        any,
        Name
      >;
    };
  };
