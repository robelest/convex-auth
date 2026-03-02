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
        null,
        Name
      >;
      accountGet: FunctionReference<
        "query",
        "internal",
        { provider: string; providerAccountId: string },
        {
          _creationTime: number;
          _id: string;
          emailVerified?: string;
          phoneVerified?: string;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        } | null,
        Name
      >;
      accountGetById: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        {
          _creationTime: number;
          _id: string;
          emailVerified?: string;
          phoneVerified?: string;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        } | null,
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
        string,
        Name
      >;
      accountListByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          emailVerified?: string;
          phoneVerified?: string;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        }>,
        Name
      >;
      accountPatch: FunctionReference<
        "mutation",
        "internal",
        { accountId: string; data: any },
        null,
        Name
      >;
      deviceAuthorize: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string; sessionId: string; userId: string },
        null,
        Name
      >;
      deviceDelete: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string },
        null,
        Name
      >;
      deviceGetByCodeHash: FunctionReference<
        "query",
        "internal",
        { deviceCodeHash: string },
        {
          _creationTime: number;
          _id: string;
          deviceCodeHash: string;
          expiresAt: number;
          interval: number;
          lastPolledAt?: number;
          sessionId?: string;
          status: "pending" | "authorized" | "denied";
          userCode: string;
          userId?: string;
        } | null,
        Name
      >;
      deviceGetByUserCode: FunctionReference<
        "query",
        "internal",
        { userCode: string },
        {
          _creationTime: number;
          _id: string;
          deviceCodeHash: string;
          expiresAt: number;
          interval: number;
          lastPolledAt?: number;
          sessionId?: string;
          status: "pending" | "authorized" | "denied";
          userCode: string;
          userId?: string;
        } | null,
        Name
      >;
      deviceInsert: FunctionReference<
        "mutation",
        "internal",
        {
          deviceCodeHash: string;
          expiresAt: number;
          interval: number;
          status: "pending" | "authorized" | "denied";
          userCode: string;
        },
        string,
        Name
      >;
      deviceUpdateLastPolled: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string; lastPolledAt: number },
        null,
        Name
      >;
      groupCreate: FunctionReference<
        "mutation",
        "internal",
        {
          extend?: any;
          name: string;
          parentGroupId?: string;
          slug?: string;
          tags?: Array<{ key: string; value: string }>;
          type?: string;
        },
        string,
        Name
      >;
      groupDelete: FunctionReference<
        "mutation",
        "internal",
        { groupId: string },
        null,
        Name
      >;
      groupGet: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        {
          _creationTime: number;
          _id: string;
          extend?: any;
          name: string;
          parentGroupId?: string;
          slug?: string;
          tags?: Array<{ key: string; value: string }>;
          type?: string;
        } | null,
        Name
      >;
      groupList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?: "_creationTime" | "name" | "slug" | "type";
          where?: {
            isRoot?: boolean;
            name?: string;
            parentGroupId?: string;
            slug?: string;
            tagsAll?: Array<{ key: string; value: string }>;
            tagsAny?: Array<{ key: string; value: string }>;
            type?: string;
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            extend?: any;
            name: string;
            parentGroupId?: string;
            slug?: string;
            tags?: Array<{ key: string; value: string }>;
            type?: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      groupUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; groupId: string },
        null,
        Name
      >;
      inviteAccept: FunctionReference<
        "mutation",
        "internal",
        { acceptedByUserId?: string; inviteId: string },
        null,
        Name
      >;
      inviteAcceptByToken: FunctionReference<
        "mutation",
        "internal",
        { acceptedByUserId: string; tokenHash: string },
        {
          groupId: string | null;
          inviteId: string;
          inviteStatus: "accepted" | "already_accepted";
          memberId?: string;
          membershipStatus: "joined" | "already_joined" | "not_applicable";
        },
        Name
      >;
      inviteCreate: FunctionReference<
        "mutation",
        "internal",
        {
          email?: string;
          expiresTime?: number;
          extend?: any;
          groupId?: string;
          invitedByUserId?: string;
          role?: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          tokenHash: string;
        },
        string,
        Name
      >;
      inviteGet: FunctionReference<
        "query",
        "internal",
        { inviteId: string },
        {
          _creationTime: number;
          _id: string;
          acceptedByUserId?: string;
          acceptedTime?: number;
          email?: string;
          expiresTime?: number;
          extend?: any;
          groupId?: string;
          invitedByUserId?: string;
          role?: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          tokenHash: string;
        } | null,
        Name
      >;
      inviteGetByTokenHash: FunctionReference<
        "query",
        "internal",
        { tokenHash: string },
        {
          _creationTime: number;
          _id: string;
          acceptedByUserId?: string;
          acceptedTime?: number;
          email?: string;
          expiresTime?: number;
          extend?: any;
          groupId?: string;
          invitedByUserId?: string;
          role?: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          tokenHash: string;
        } | null,
        Name
      >;
      inviteList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?:
            | "_creationTime"
            | "status"
            | "email"
            | "expiresTime"
            | "acceptedTime";
          where?: {
            acceptedByUserId?: string;
            email?: string;
            groupId?: string;
            invitedByUserId?: string;
            role?: string;
            status?: "pending" | "accepted" | "revoked" | "expired";
            tokenHash?: string;
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            acceptedByUserId?: string;
            acceptedTime?: number;
            email?: string;
            expiresTime?: number;
            extend?: any;
            groupId?: string;
            invitedByUserId?: string;
            role?: string;
            status: "pending" | "accepted" | "revoked" | "expired";
            tokenHash: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      inviteRevoke: FunctionReference<
        "mutation",
        "internal",
        { inviteId: string },
        null,
        Name
      >;
      keyDelete: FunctionReference<
        "mutation",
        "internal",
        { keyId: string },
        null,
        Name
      >;
      keyGetByHashedKey: FunctionReference<
        "query",
        "internal",
        { hashedKey: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          expiresAt?: number;
          hashedKey: string;
          lastUsedAt?: number;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
          revoked: boolean;
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        } | null,
        Name
      >;
      keyGetById: FunctionReference<
        "query",
        "internal",
        { keyId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          expiresAt?: number;
          hashedKey: string;
          lastUsedAt?: number;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
          revoked: boolean;
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        } | null,
        Name
      >;
      keyInsert: FunctionReference<
        "mutation",
        "internal",
        {
          expiresAt?: number;
          hashedKey: string;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        },
        string,
        Name
      >;
      keyList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?:
            | "_creationTime"
            | "name"
            | "lastUsedAt"
            | "expiresAt"
            | "revoked";
          where?: {
            name?: string;
            prefix?: string;
            revoked?: boolean;
            userId?: string;
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            createdAt: number;
            expiresAt?: number;
            hashedKey: string;
            lastUsedAt?: number;
            name: string;
            prefix: string;
            rateLimit?: { maxRequests: number; windowMs: number };
            rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
            revoked: boolean;
            scopes: Array<{ actions: Array<string>; resource: string }>;
            userId: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      keyListByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          createdAt: number;
          expiresAt?: number;
          hashedKey: string;
          lastUsedAt?: number;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
          revoked: boolean;
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        }>,
        Name
      >;
      keyPatch: FunctionReference<
        "mutation",
        "internal",
        {
          data: {
            lastUsedAt?: number;
            name?: string;
            rateLimit?: { maxRequests: number; windowMs: number };
            rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
            revoked?: boolean;
            scopes?: Array<{ actions: Array<string>; resource: string }>;
          };
          keyId: string;
        },
        null,
        Name
      >;
      memberAdd: FunctionReference<
        "mutation",
        "internal",
        {
          extend?: any;
          groupId: string;
          role?: string;
          status?: string;
          userId: string;
        },
        string,
        Name
      >;
      memberGet: FunctionReference<
        "query",
        "internal",
        { memberId: string },
        {
          _creationTime: number;
          _id: string;
          extend?: any;
          groupId: string;
          role?: string;
          status?: string;
          userId: string;
        } | null,
        Name
      >;
      memberGetByGroupAndUser: FunctionReference<
        "query",
        "internal",
        { groupId: string; userId: string },
        {
          _creationTime: number;
          _id: string;
          extend?: any;
          groupId: string;
          role?: string;
          status?: string;
          userId: string;
        } | null,
        Name
      >;
      memberList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?: "_creationTime" | "role" | "status";
          where?: {
            groupId?: string;
            role?: string;
            status?: string;
            userId?: string;
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            extend?: any;
            groupId: string;
            role?: string;
            status?: string;
            userId: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      memberListByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          extend?: any;
          groupId: string;
          role?: string;
          status?: string;
          userId: string;
        }>,
        Name
      >;
      memberRemove: FunctionReference<
        "mutation",
        "internal",
        { memberId: string },
        null,
        Name
      >;
      memberUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; memberId: string },
        null,
        Name
      >;
      passkeyDelete: FunctionReference<
        "mutation",
        "internal",
        { passkeyId: string },
        null,
        Name
      >;
      passkeyGetByCredentialId: FunctionReference<
        "query",
        "internal",
        { credentialId: string },
        {
          _creationTime: number;
          _id: string;
          algorithm: number;
          backedUp: boolean;
          counter: number;
          createdAt: number;
          credentialId: string;
          deviceType: string;
          lastUsedAt?: number;
          name?: string;
          publicKey: ArrayBuffer;
          transports?: Array<string>;
          userId: string;
        } | null,
        Name
      >;
      passkeyInsert: FunctionReference<
        "mutation",
        "internal",
        {
          algorithm: number;
          backedUp: boolean;
          counter: number;
          createdAt: number;
          credentialId: string;
          deviceType: string;
          name?: string;
          publicKey: ArrayBuffer;
          transports?: Array<string>;
          userId: string;
        },
        string,
        Name
      >;
      passkeyListByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          algorithm: number;
          backedUp: boolean;
          counter: number;
          createdAt: number;
          credentialId: string;
          deviceType: string;
          lastUsedAt?: number;
          name?: string;
          publicKey: ArrayBuffer;
          transports?: Array<string>;
          userId: string;
        }>,
        Name
      >;
      passkeyUpdateCounter: FunctionReference<
        "mutation",
        "internal",
        { counter: number; lastUsedAt: number; passkeyId: string },
        null,
        Name
      >;
      passkeyUpdateMeta: FunctionReference<
        "mutation",
        "internal",
        { data: any; passkeyId: string },
        null,
        Name
      >;
      rateLimitCreate: FunctionReference<
        "mutation",
        "internal",
        { attemptsLeft: number; identifier: string; lastAttemptTime: number },
        string,
        Name
      >;
      rateLimitDelete: FunctionReference<
        "mutation",
        "internal",
        { rateLimitId: string },
        null,
        Name
      >;
      rateLimitGet: FunctionReference<
        "query",
        "internal",
        { identifier: string },
        {
          _creationTime: number;
          _id: string;
          attemptsLeft: number;
          attempts_left: number;
          identifier: string;
          lastAttemptTime: number;
          last_attempt_time: number;
        } | null,
        Name
      >;
      rateLimitPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; rateLimitId: string },
        null,
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
        string,
        Name
      >;
      refreshTokenDeleteAll: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null,
        Name
      >;
      refreshTokenGetActive: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        {
          _creationTime: number;
          _id: string;
          expirationTime: number;
          firstUsedTime?: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        } | null,
        Name
      >;
      refreshTokenGetById: FunctionReference<
        "query",
        "internal",
        { refreshTokenId: string },
        {
          _creationTime: number;
          _id: string;
          expirationTime: number;
          firstUsedTime?: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        } | null,
        Name
      >;
      refreshTokenGetChildren: FunctionReference<
        "query",
        "internal",
        { parentRefreshTokenId: string; sessionId: string },
        Array<{
          _creationTime: number;
          _id: string;
          expirationTime: number;
          firstUsedTime?: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        }>,
        Name
      >;
      refreshTokenListBySession: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        Array<{
          _creationTime: number;
          _id: string;
          expirationTime: number;
          firstUsedTime?: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        }>,
        Name
      >;
      refreshTokenPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; refreshTokenId: string },
        null,
        Name
      >;
      sessionCreate: FunctionReference<
        "mutation",
        "internal",
        { expirationTime: number; userId: string },
        string,
        Name
      >;
      sessionDelete: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null,
        Name
      >;
      sessionGetById: FunctionReference<
        "query",
        "internal",
        { sessionId: string },
        {
          _creationTime: number;
          _id: string;
          expirationTime: number;
          userId: string;
        } | null,
        Name
      >;
      sessionList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          where?: { userId?: string };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            expirationTime: number;
            userId: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      sessionListByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          expirationTime: number;
          userId: string;
        }>,
        Name
      >;
      totpDelete: FunctionReference<
        "mutation",
        "internal",
        { totpId: string },
        null,
        Name
      >;
      totpGetById: FunctionReference<
        "query",
        "internal",
        { totpId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          digits: number;
          lastUsedAt?: number;
          name?: string;
          period: number;
          secret: ArrayBuffer;
          userId: string;
          verified: boolean;
        } | null,
        Name
      >;
      totpGetVerifiedByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          _creationTime: number;
          _id: string;
          createdAt: number;
          digits: number;
          lastUsedAt?: number;
          name?: string;
          period: number;
          secret: ArrayBuffer;
          userId: string;
          verified: boolean;
        } | null,
        Name
      >;
      totpInsert: FunctionReference<
        "mutation",
        "internal",
        {
          createdAt: number;
          digits: number;
          name?: string;
          period: number;
          secret: ArrayBuffer;
          userId: string;
          verified: boolean;
        },
        string,
        Name
      >;
      totpListByUserId: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          createdAt: number;
          digits: number;
          lastUsedAt?: number;
          name?: string;
          period: number;
          secret: ArrayBuffer;
          userId: string;
          verified: boolean;
        }>,
        Name
      >;
      totpMarkVerified: FunctionReference<
        "mutation",
        "internal",
        { lastUsedAt: number; totpId: string },
        null,
        Name
      >;
      totpUpdateLastUsed: FunctionReference<
        "mutation",
        "internal",
        { lastUsedAt: number; totpId: string },
        null,
        Name
      >;
      userFindByVerifiedEmail: FunctionReference<
        "query",
        "internal",
        { email: string },
        {
          _creationTime: number;
          _id: string;
          email?: string;
          emailVerificationTime?: number;
          extend?: any;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
          phone?: string;
          phoneVerificationTime?: number;
        } | null,
        Name
      >;
      userFindByVerifiedPhone: FunctionReference<
        "query",
        "internal",
        { phone: string },
        {
          _creationTime: number;
          _id: string;
          email?: string;
          emailVerificationTime?: number;
          extend?: any;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
          phone?: string;
          phoneVerificationTime?: number;
        } | null,
        Name
      >;
      userGetById: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          _creationTime: number;
          _id: string;
          email?: string;
          emailVerificationTime?: number;
          extend?: any;
          image?: string;
          isAnonymous?: boolean;
          name?: string;
          phone?: string;
          phoneVerificationTime?: number;
        } | null,
        Name
      >;
      userInsert: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        string,
        Name
      >;
      userList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?: "_creationTime" | "name" | "email" | "phone";
          where?: {
            email?: string;
            isAnonymous?: boolean;
            name?: string;
            phone?: string;
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            email?: string;
            emailVerificationTime?: number;
            extend?: any;
            image?: string;
            isAnonymous?: boolean;
            name?: string;
            phone?: string;
            phoneVerificationTime?: number;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      userPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId: string },
        null,
        Name
      >;
      userUpsert: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId?: string },
        string,
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
        string,
        Name
      >;
      verificationCodeDelete: FunctionReference<
        "mutation",
        "internal",
        { verificationCodeId: string },
        null,
        Name
      >;
      verificationCodeGetByAccountId: FunctionReference<
        "query",
        "internal",
        { accountId: string },
        {
          _creationTime: number;
          _id: string;
          accountId: string;
          code: string;
          emailVerified?: string;
          expirationTime: number;
          phoneVerified?: string;
          provider: string;
          verifier?: string;
        } | null,
        Name
      >;
      verificationCodeGetByCode: FunctionReference<
        "query",
        "internal",
        { code: string },
        {
          _creationTime: number;
          _id: string;
          accountId: string;
          code: string;
          emailVerified?: string;
          expirationTime: number;
          phoneVerified?: string;
          provider: string;
          verifier?: string;
        } | null,
        Name
      >;
      verifierCreate: FunctionReference<
        "mutation",
        "internal",
        { sessionId?: string },
        string,
        Name
      >;
      verifierDelete: FunctionReference<
        "mutation",
        "internal",
        { verifierId: string },
        null,
        Name
      >;
      verifierGetById: FunctionReference<
        "query",
        "internal",
        { verifierId: string },
        {
          _creationTime: number;
          _id: string;
          sessionId?: string;
          signature?: string;
        } | null,
        Name
      >;
      verifierGetBySignature: FunctionReference<
        "query",
        "internal",
        { signature: string },
        {
          _creationTime: number;
          _id: string;
          sessionId?: string;
          signature?: string;
        } | null,
        Name
      >;
      verifierPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; verifierId: string },
        null,
        Name
      >;
    };
  };
