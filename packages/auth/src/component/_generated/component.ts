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
    account: {
      create: FunctionReference<
        "mutation",
        "internal",
        {
          extend?: any;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        },
        string,
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { accountId: string; requireOtherAccount?: boolean },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id?: string; provider?: string; providerAccountId?: string },
        {
          _creationTime: number;
          _id: string;
          emailVerified?: string;
          extend?: any;
          phoneVerified?: string;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        } | null,
        Name
      >;
      listByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          emailVerified?: string;
          extend?: any;
          phoneVerified?: string;
          provider: string;
          providerAccountId: string;
          secret?: string;
          userId: string;
        }>,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        { accountId: string; data: any },
        null,
        Name
      >;
    };
    group: {
      ancestors: FunctionReference<
        "query",
        "internal",
        { groupId: string; includeSelf?: boolean; maxDepth?: number },
        {
          ancestors: Array<{
            _creationTime: number;
            _id: string;
            extend?: any;
            isRoot?: boolean;
            name: string;
            parentGroupId?: string;
            policy?: {
              extend?: any;
              identity: {
                accountLinking: {
                  oidc: "verifiedEmail" | "none" | "sameConnection";
                  saml: "verifiedEmail" | "none" | "sameConnection";
                };
              };
              provisioning: {
                deprovision: { mode: "soft" | "hard" };
                groups: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "sync";
                  source: "protocol";
                };
                jit: {
                  defaultRole?: string;
                  defaultRoleIds?: Array<string>;
                  mode: "off" | "createUser" | "createUserAndMembership";
                };
                roles: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "map";
                  source: "protocol";
                };
                scimReuse: { user: "externalId" | "none" };
                user: {
                  authority: "app" | "sso" | "scim";
                  createOnSignIn: boolean;
                  updateProfileFromScim: "never" | "missing" | "always";
                  updateProfileOnLogin: "never" | "missing" | "always";
                };
              };
              version: 1;
            };
            rootGroupId?: string;
            slug?: string;
            tags?: Array<{ key: string; value: string }>;
            type?: string;
          }>;
          cycleDetected: boolean;
          maxDepthReached: boolean;
        },
        Name
      >;
      create: FunctionReference<
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
      delete: FunctionReference<
        "mutation",
        "internal",
        { groupId: string },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id?: string; ids?: Array<string> },
        | {
            _creationTime: number;
            _id: string;
            extend?: any;
            isRoot?: boolean;
            name: string;
            parentGroupId?: string;
            policy?: {
              extend?: any;
              identity: {
                accountLinking: {
                  oidc: "verifiedEmail" | "none" | "sameConnection";
                  saml: "verifiedEmail" | "none" | "sameConnection";
                };
              };
              provisioning: {
                deprovision: { mode: "soft" | "hard" };
                groups: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "sync";
                  source: "protocol";
                };
                jit: {
                  defaultRole?: string;
                  defaultRoleIds?: Array<string>;
                  mode: "off" | "createUser" | "createUserAndMembership";
                };
                roles: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "map";
                  source: "protocol";
                };
                scimReuse: { user: "externalId" | "none" };
                user: {
                  authority: "app" | "sso" | "scim";
                  createOnSignIn: boolean;
                  updateProfileFromScim: "never" | "missing" | "always";
                  updateProfileOnLogin: "never" | "missing" | "always";
                };
              };
              version: 1;
            };
            rootGroupId?: string;
            slug?: string;
            tags?: Array<{ key: string; value: string }>;
            type?: string;
          }
        | null
        | Array<{
            _creationTime: number;
            _id: string;
            extend?: any;
            isRoot?: boolean;
            name: string;
            parentGroupId?: string;
            policy?: {
              extend?: any;
              identity: {
                accountLinking: {
                  oidc: "verifiedEmail" | "none" | "sameConnection";
                  saml: "verifiedEmail" | "none" | "sameConnection";
                };
              };
              provisioning: {
                deprovision: { mode: "soft" | "hard" };
                groups: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "sync";
                  source: "protocol";
                };
                jit: {
                  defaultRole?: string;
                  defaultRoleIds?: Array<string>;
                  mode: "off" | "createUser" | "createUserAndMembership";
                };
                roles: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "map";
                  source: "protocol";
                };
                scimReuse: { user: "externalId" | "none" };
                user: {
                  authority: "app" | "sso" | "scim";
                  createOnSignIn: boolean;
                  updateProfileFromScim: "never" | "missing" | "always";
                  updateProfileOnLogin: "never" | "missing" | "always";
                };
              };
              version: 1;
            };
            rootGroupId?: string;
            slug?: string;
            tags?: Array<{ key: string; value: string }>;
            type?: string;
          } | null>,
        Name
      >;
      invite: {
        accept: FunctionReference<
          "mutation",
          "internal",
          { acceptedByUserId?: string; inviteId: string },
          null,
          Name
        >;
        acceptByToken: FunctionReference<
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
        create: FunctionReference<
          "mutation",
          "internal",
          {
            email?: string;
            expiresTime?: number;
            extend?: any;
            groupId?: string;
            invitedByUserId?: string;
            roleIds?: Array<string>;
            status: "pending" | "accepted" | "revoked" | "expired";
            tokenHash: string;
          },
          string,
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { id?: string; tokenHash?: string },
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
            roleIds?: Array<string>;
            status: "pending" | "accepted" | "revoked" | "expired";
            tokenHash: string;
          } | null,
          Name
        >;
        list: FunctionReference<
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
              roleId?: string;
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
              roleIds?: Array<string>;
              status: "pending" | "accepted" | "revoked" | "expired";
              tokenHash: string;
            }>;
            nextCursor: string | null;
          },
          Name
        >;
        revoke: FunctionReference<
          "mutation",
          "internal",
          { inviteId: string },
          null,
          Name
        >;
      };
      list: FunctionReference<
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
            isRoot?: boolean;
            name: string;
            parentGroupId?: string;
            policy?: {
              extend?: any;
              identity: {
                accountLinking: {
                  oidc: "verifiedEmail" | "none" | "sameConnection";
                  saml: "verifiedEmail" | "none" | "sameConnection";
                };
              };
              provisioning: {
                deprovision: { mode: "soft" | "hard" };
                groups: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "sync";
                  source: "protocol";
                };
                jit: {
                  defaultRole?: string;
                  defaultRoleIds?: Array<string>;
                  mode: "off" | "createUser" | "createUserAndMembership";
                };
                roles: {
                  mapping?: Record<string, Array<string>>;
                  mode: "ignore" | "map";
                  source: "protocol";
                };
                scimReuse: { user: "externalId" | "none" };
                user: {
                  authority: "app" | "sso" | "scim";
                  createOnSignIn: boolean;
                  updateProfileFromScim: "never" | "missing" | "always";
                  updateProfileOnLogin: "never" | "missing" | "always";
                };
              };
              version: 1;
            };
            rootGroupId?: string;
            slug?: string;
            tags?: Array<{ key: string; value: string }>;
            type?: string;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      member: {
        create: FunctionReference<
          "mutation",
          "internal",
          {
            extend?: any;
            groupId: string;
            roleIds?: Array<string>;
            status?: string;
            userId: string;
          },
          string,
          Name
        >;
        delete: FunctionReference<
          "mutation",
          "internal",
          { memberId: string },
          null,
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { groupId?: string; id?: string; userId?: string },
          {
            _creationTime: number;
            _id: string;
            extend?: any;
            groupId: string;
            role?: string;
            roleIds?: Array<string>;
            status?: string;
            userId: string;
          } | null,
          Name
        >;
        getMany: FunctionReference<
          "query",
          "internal",
          { groupIds: Array<string>; userId: string },
          Array<{
            _creationTime: number;
            _id: string;
            extend?: any;
            groupId: string;
            role?: string;
            roleIds?: Array<string>;
            status?: string;
            userId: string;
          } | null>,
          Name
        >;
        list: FunctionReference<
          "query",
          "internal",
          {
            cursor?: string | null;
            limit?: number;
            order?: "asc" | "desc";
            orderBy?: "_creationTime" | "status";
            where?: {
              groupId?: string;
              roleId?: string;
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
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            }>;
            nextCursor: string | null;
          },
          Name
        >;
        resolve: FunctionReference<
          "query",
          "internal",
          {
            ancestry?: boolean;
            groupId: string;
            maxDepth?: number;
            userId: string;
          },
          {
            depth: number | null;
            isDirect: boolean;
            isInherited: boolean;
            matchedGroupId: string | null;
            membership: {
              _creationTime: number;
              _id: string;
              extend?: any;
              groupId: string;
              role?: string;
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            } | null;
            traversedGroupIds?: Array<string>;
          },
          Name
        >;
        update: FunctionReference<
          "mutation",
          "internal",
          { data: any; memberId: string },
          null,
          Name
        >;
      };
      update: FunctionReference<
        "mutation",
        "internal",
        { data: any; groupId: string },
        null,
        Name
      >;
    };
    public: {
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
      factors: {
        devices: {
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
        };
        passkeys: {
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
          passkeyGetById: FunctionReference<
            "query",
            "internal",
            { passkeyId: string },
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
        };
        totp: {
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
        };
      };
      groupAuditEventCreate: FunctionReference<
        "mutation",
        "internal",
        {
          actorId?: string;
          actorType: "user" | "system" | "scim" | "api_key" | "webhook";
          connectionId?: string;
          eventType: string;
          groupId: string;
          ip?: string;
          metadata?: any;
          occurredAt: number;
          requestId?: string;
          status: "success" | "failure";
          subjectId?: string;
          subjectType: string;
        },
        string,
        Name
      >;
      groupAuditEventList: FunctionReference<
        "query",
        "internal",
        { connectionId?: string; groupId?: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          actorId?: string;
          actorType: "user" | "system" | "scim" | "api_key" | "webhook";
          connectionId?: string;
          eventType: string;
          groupId: string;
          ip?: string;
          metadata?: any;
          occurredAt: number;
          requestId?: string;
          status: "success" | "failure";
          subjectId?: string;
          subjectType: string;
        }>,
        Name
      >;
      groupConnectionCreate: FunctionReference<
        "mutation",
        "internal",
        {
          config?: any;
          extend?: any;
          groupId: string;
          name?: string;
          protocol: "oidc" | "saml";
          slug?: string;
          status?: "draft" | "active" | "disabled";
        },
        string,
        Name
      >;
      groupConnectionDelete: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string },
        null,
        Name
      >;
      groupConnectionDomainAdd: FunctionReference<
        "mutation",
        "internal",
        {
          connectionId: string;
          domain: string;
          groupId: string;
          isPrimary?: boolean;
        },
        string,
        Name
      >;
      groupConnectionDomainDelete: FunctionReference<
        "mutation",
        "internal",
        { domainId: string },
        null,
        Name
      >;
      groupConnectionDomainList: FunctionReference<
        "query",
        "internal",
        { connectionId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          connectionId: string;
          domain: string;
          groupId: string;
          isPrimary: boolean;
          verifiedAt?: number;
        }>,
        Name
      >;
      groupConnectionDomainVerificationDelete: FunctionReference<
        "mutation",
        "internal",
        { domainId: string },
        null,
        Name
      >;
      groupConnectionDomainVerificationGet: FunctionReference<
        "query",
        "internal",
        { domainId: string },
        {
          _creationTime: number;
          _id: string;
          connectionId: string;
          domain: string;
          domainId: string;
          expiresAt: number;
          groupId: string;
          recordName: string;
          requestedAt: number;
          token: string;
          tokenHash: string;
        } | null,
        Name
      >;
      groupConnectionDomainVerificationUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          connectionId: string;
          domain: string;
          domainId: string;
          expiresAt: number;
          groupId: string;
          recordName: string;
          requestedAt: number;
          token: string;
          tokenHash: string;
        },
        string,
        Name
      >;
      groupConnectionDomainVerify: FunctionReference<
        "mutation",
        "internal",
        { domainId: string; verifiedAt: number },
        {
          _creationTime: number;
          _id: string;
          connectionId: string;
          domain: string;
          groupId: string;
          isPrimary: boolean;
          verifiedAt?: number;
        },
        Name
      >;
      groupConnectionGet: FunctionReference<
        "query",
        "internal",
        { connectionId: string },
        {
          _creationTime: number;
          _id: string;
          config?: any;
          extend?: any;
          groupId: string;
          name?: string;
          protocol: "oidc" | "saml";
          slug?: string;
          status: "draft" | "active" | "disabled";
        } | null,
        Name
      >;
      groupConnectionGetByDomain: FunctionReference<
        "query",
        "internal",
        { domain: string },
        {
          connection: {
            _creationTime: number;
            _id: string;
            config?: any;
            extend?: any;
            groupId: string;
            name?: string;
            protocol: "oidc" | "saml";
            slug?: string;
            status: "draft" | "active" | "disabled";
          };
          domain: {
            _creationTime: number;
            _id: string;
            connectionId: string;
            domain: string;
            groupId: string;
            isPrimary: boolean;
            verifiedAt?: number;
          };
        } | null,
        Name
      >;
      groupConnectionList: FunctionReference<
        "query",
        "internal",
        {
          cursor?: string | null;
          limit?: number;
          order?: "asc" | "desc";
          orderBy?: "_creationTime" | "name" | "slug" | "status";
          where?: {
            groupId?: string;
            slug?: string;
            status?: "draft" | "active" | "disabled";
          };
        },
        {
          items: Array<{
            _creationTime: number;
            _id: string;
            config?: any;
            extend?: any;
            groupId: string;
            name?: string;
            protocol: "oidc" | "saml";
            slug?: string;
            status: "draft" | "active" | "disabled";
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      groupConnectionScimConfigGetByGroupConnection: FunctionReference<
        "query",
        "internal",
        { connectionId: string },
        {
          _creationTime: number;
          _id: string;
          basePath: string;
          connectionId: string;
          extend?: any;
          groupId: string;
          lastRotatedAt?: number;
          status: "draft" | "active" | "disabled";
          tokenHash: string;
        } | null,
        Name
      >;
      groupConnectionScimConfigGetByTokenHash: FunctionReference<
        "query",
        "internal",
        { tokenHash: string },
        {
          _creationTime: number;
          _id: string;
          basePath: string;
          connectionId: string;
          extend?: any;
          groupId: string;
          lastRotatedAt?: number;
          status: "draft" | "active" | "disabled";
          tokenHash: string;
        } | null,
        Name
      >;
      groupConnectionScimConfigUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          basePath: string;
          connectionId: string;
          extend?: any;
          groupId: string;
          lastRotatedAt?: number;
          status: "draft" | "active" | "disabled";
          tokenHash: string;
        },
        string,
        Name
      >;
      groupConnectionScimIdentityDelete: FunctionReference<
        "mutation",
        "internal",
        { identityId: string },
        null,
        Name
      >;
      groupConnectionScimIdentityGet: FunctionReference<
        "query",
        "internal",
        {
          connectionId: string;
          externalId: string;
          resourceType: "user" | "group";
        },
        {
          _creationTime: number;
          _id: string;
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        } | null,
        Name
      >;
      groupConnectionScimIdentityGetByGroupConnectionAndUser: FunctionReference<
        "query",
        "internal",
        { connectionId: string; userId: string },
        {
          _creationTime: number;
          _id: string;
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        } | null,
        Name
      >;
      groupConnectionScimIdentityGetByGroupConnectionAndUsers: FunctionReference<
        "query",
        "internal",
        { connectionId: string; userIds: Array<string> },
        Array<{
          identity: {
            _creationTime: number;
            _id: string;
            active?: boolean;
            connectionId: string;
            externalId: string;
            groupId: string;
            lastProvisionedAt?: number;
            mappedGroupId?: string;
            raw?: any;
            resourceType: "user" | "group";
            userId?: string;
          } | null;
          userId: string;
        }>,
        Name
      >;
      groupConnectionScimIdentityGetByMappedGroup: FunctionReference<
        "query",
        "internal",
        { mappedGroupId: string },
        {
          _creationTime: number;
          _id: string;
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        } | null,
        Name
      >;
      groupConnectionScimIdentityGetByUser: FunctionReference<
        "query",
        "internal",
        { userId: string },
        {
          _creationTime: number;
          _id: string;
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        } | null,
        Name
      >;
      groupConnectionScimIdentityListByGroupConnection: FunctionReference<
        "query",
        "internal",
        { connectionId: string },
        Array<{
          _creationTime: number;
          _id: string;
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        }>,
        Name
      >;
      groupConnectionScimIdentityUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          active?: boolean;
          connectionId: string;
          externalId: string;
          groupId: string;
          lastProvisionedAt?: number;
          mappedGroupId?: string;
          raw?: any;
          resourceType: "user" | "group";
          userId?: string;
        },
        string,
        Name
      >;
      groupConnectionSecretDelete: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string; kind: "oidc_client_secret" },
        null,
        Name
      >;
      groupConnectionSecretGet: FunctionReference<
        "query",
        "internal",
        { connectionId: string; kind: "oidc_client_secret" },
        {
          _creationTime: number;
          _id: string;
          ciphertext: string;
          connectionId: string;
          groupId: string;
          kind: "oidc_client_secret";
          updatedAt: number;
        } | null,
        Name
      >;
      groupConnectionSecretUpsert: FunctionReference<
        "mutation",
        "internal",
        {
          ciphertext: string;
          connectionId: string;
          groupId: string;
          kind: "oidc_client_secret";
          updatedAt: number;
        },
        string,
        Name
      >;
      groupConnectionUpdate: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string; data: any },
        null,
        Name
      >;
      groups: {
        core: {
          groupAncestors: FunctionReference<
            "query",
            "internal",
            { groupId: string; includeSelf?: boolean; maxDepth?: number },
            {
              ancestors: Array<{
                _creationTime: number;
                _id: string;
                extend?: any;
                isRoot?: boolean;
                name: string;
                parentGroupId?: string;
                policy?: {
                  extend?: any;
                  identity: {
                    accountLinking: {
                      oidc: "verifiedEmail" | "none" | "sameConnection";
                      saml: "verifiedEmail" | "none" | "sameConnection";
                    };
                  };
                  provisioning: {
                    deprovision: { mode: "soft" | "hard" };
                    groups: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "sync";
                      source: "protocol";
                    };
                    jit: {
                      defaultRole?: string;
                      defaultRoleIds?: Array<string>;
                      mode: "off" | "createUser" | "createUserAndMembership";
                    };
                    roles: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "map";
                      source: "protocol";
                    };
                    scimReuse: { user: "externalId" | "none" };
                    user: {
                      authority: "app" | "sso" | "scim";
                      createOnSignIn: boolean;
                      updateProfileFromScim: "never" | "missing" | "always";
                      updateProfileOnLogin: "never" | "missing" | "always";
                    };
                  };
                  version: 1;
                };
                rootGroupId?: string;
                slug?: string;
                tags?: Array<{ key: string; value: string }>;
                type?: string;
              }>;
              cycleDetected: boolean;
              maxDepthReached: boolean;
            },
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
            { id?: string; ids?: Array<string> },
            | {
                _creationTime: number;
                _id: string;
                extend?: any;
                isRoot?: boolean;
                name: string;
                parentGroupId?: string;
                policy?: {
                  extend?: any;
                  identity: {
                    accountLinking: {
                      oidc: "verifiedEmail" | "none" | "sameConnection";
                      saml: "verifiedEmail" | "none" | "sameConnection";
                    };
                  };
                  provisioning: {
                    deprovision: { mode: "soft" | "hard" };
                    groups: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "sync";
                      source: "protocol";
                    };
                    jit: {
                      defaultRole?: string;
                      defaultRoleIds?: Array<string>;
                      mode: "off" | "createUser" | "createUserAndMembership";
                    };
                    roles: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "map";
                      source: "protocol";
                    };
                    scimReuse: { user: "externalId" | "none" };
                    user: {
                      authority: "app" | "sso" | "scim";
                      createOnSignIn: boolean;
                      updateProfileFromScim: "never" | "missing" | "always";
                      updateProfileOnLogin: "never" | "missing" | "always";
                    };
                  };
                  version: 1;
                };
                rootGroupId?: string;
                slug?: string;
                tags?: Array<{ key: string; value: string }>;
                type?: string;
              }
            | null
            | Array<{
                _creationTime: number;
                _id: string;
                extend?: any;
                isRoot?: boolean;
                name: string;
                parentGroupId?: string;
                policy?: {
                  extend?: any;
                  identity: {
                    accountLinking: {
                      oidc: "verifiedEmail" | "none" | "sameConnection";
                      saml: "verifiedEmail" | "none" | "sameConnection";
                    };
                  };
                  provisioning: {
                    deprovision: { mode: "soft" | "hard" };
                    groups: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "sync";
                      source: "protocol";
                    };
                    jit: {
                      defaultRole?: string;
                      defaultRoleIds?: Array<string>;
                      mode: "off" | "createUser" | "createUserAndMembership";
                    };
                    roles: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "map";
                      source: "protocol";
                    };
                    scimReuse: { user: "externalId" | "none" };
                    user: {
                      authority: "app" | "sso" | "scim";
                      createOnSignIn: boolean;
                      updateProfileFromScim: "never" | "missing" | "always";
                      updateProfileOnLogin: "never" | "missing" | "always";
                    };
                  };
                  version: 1;
                };
                rootGroupId?: string;
                slug?: string;
                tags?: Array<{ key: string; value: string }>;
                type?: string;
              } | null>,
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
                isRoot?: boolean;
                name: string;
                parentGroupId?: string;
                policy?: {
                  extend?: any;
                  identity: {
                    accountLinking: {
                      oidc: "verifiedEmail" | "none" | "sameConnection";
                      saml: "verifiedEmail" | "none" | "sameConnection";
                    };
                  };
                  provisioning: {
                    deprovision: { mode: "soft" | "hard" };
                    groups: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "sync";
                      source: "protocol";
                    };
                    jit: {
                      defaultRole?: string;
                      defaultRoleIds?: Array<string>;
                      mode: "off" | "createUser" | "createUserAndMembership";
                    };
                    roles: {
                      mapping?: Record<string, Array<string>>;
                      mode: "ignore" | "map";
                      source: "protocol";
                    };
                    scimReuse: { user: "externalId" | "none" };
                    user: {
                      authority: "app" | "sso" | "scim";
                      createOnSignIn: boolean;
                      updateProfileFromScim: "never" | "missing" | "always";
                      updateProfileOnLogin: "never" | "missing" | "always";
                    };
                  };
                  version: 1;
                };
                rootGroupId?: string;
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
        };
        invites: {
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
              roleIds?: Array<string>;
              status: "pending" | "accepted" | "revoked" | "expired";
              tokenHash: string;
            },
            string,
            Name
          >;
          inviteGet: FunctionReference<
            "query",
            "internal",
            { id?: string; tokenHash?: string },
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
              roleIds?: Array<string>;
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
                roleId?: string;
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
                roleIds?: Array<string>;
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
        };
        members: {
          memberAdd: FunctionReference<
            "mutation",
            "internal",
            {
              extend?: any;
              groupId: string;
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            },
            string,
            Name
          >;
          memberGet: FunctionReference<
            "query",
            "internal",
            { groupId?: string; id?: string; userId?: string },
            {
              _creationTime: number;
              _id: string;
              extend?: any;
              groupId: string;
              role?: string;
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            } | null,
            Name
          >;
          memberGetByGroupAndUserMany: FunctionReference<
            "query",
            "internal",
            { groupIds: Array<string>; userId: string },
            Array<{
              _creationTime: number;
              _id: string;
              extend?: any;
              groupId: string;
              role?: string;
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            } | null>,
            Name
          >;
          memberList: FunctionReference<
            "query",
            "internal",
            {
              cursor?: string | null;
              limit?: number;
              order?: "asc" | "desc";
              orderBy?: "_creationTime" | "status";
              where?: {
                groupId?: string;
                roleId?: string;
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
                roleIds?: Array<string>;
                status?: string;
                userId: string;
              }>;
              nextCursor: string | null;
            },
            Name
          >;
          memberRemove: FunctionReference<
            "mutation",
            "internal",
            { memberId: string },
            null,
            Name
          >;
          memberResolve: FunctionReference<
            "query",
            "internal",
            {
              ancestry?: boolean;
              groupId: string;
              maxDepth?: number;
              userId: string;
            },
            {
              depth: number | null;
              isDirect: boolean;
              isInherited: boolean;
              matchedGroupId: string | null;
              membership: {
                _creationTime: number;
                _id: string;
                extend?: any;
                groupId: string;
                role?: string;
                roleIds?: Array<string>;
                status?: string;
                userId: string;
              } | null;
              traversedGroupIds?: Array<string>;
            },
            Name
          >;
          memberUpdate: FunctionReference<
            "mutation",
            "internal",
            { data: any; memberId: string },
            null,
            Name
          >;
        };
      };
      groupWebhookDeliveryEnqueue: FunctionReference<
        "mutation",
        "internal",
        {
          auditEventId?: string;
          connectionId: string;
          endpointId: string;
          eventType: string;
          nextAttemptAt: number;
          payload: any;
        },
        string,
        Name
      >;
      groupWebhookDeliveryList: FunctionReference<
        "query",
        "internal",
        { connectionId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          attemptCount: number;
          auditEventId?: string;
          connectionId: string;
          endpointId: string;
          eventType: string;
          lastAttemptAt?: number;
          lastError?: string;
          lastResponseStatus?: number;
          nextAttemptAt: number;
          payload: any;
          status: "pending" | "processing" | "delivered" | "failed";
        }>,
        Name
      >;
      groupWebhookDeliveryListReady: FunctionReference<
        "query",
        "internal",
        { limit?: number; now: number },
        Array<{
          _creationTime: number;
          _id: string;
          attemptCount: number;
          auditEventId?: string;
          connectionId: string;
          endpointId: string;
          eventType: string;
          lastAttemptAt?: number;
          lastError?: string;
          lastResponseStatus?: number;
          nextAttemptAt: number;
          payload: any;
          status: "pending" | "processing" | "delivered" | "failed";
        }>,
        Name
      >;
      groupWebhookDeliveryPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; deliveryId: string },
        null,
        Name
      >;
      groupWebhookEndpointCreate: FunctionReference<
        "mutation",
        "internal",
        {
          connectionId: string;
          createdByUserId?: string;
          extend?: any;
          groupId: string;
          secretHash: string;
          status?: "active" | "disabled";
          subscriptions: Array<string>;
          url: string;
        },
        string,
        Name
      >;
      groupWebhookEndpointGet: FunctionReference<
        "query",
        "internal",
        { endpointId: string },
        {
          _creationTime: number;
          _id: string;
          connectionId: string;
          createdByUserId?: string;
          extend?: any;
          failureCount: number;
          groupId: string;
          lastFailureAt?: number;
          lastSuccessAt?: number;
          secretHash: string;
          status: "active" | "disabled";
          subscriptions: Array<string>;
          url: string;
        } | null,
        Name
      >;
      groupWebhookEndpointList: FunctionReference<
        "query",
        "internal",
        { connectionId: string },
        Array<{
          _creationTime: number;
          _id: string;
          connectionId: string;
          createdByUserId?: string;
          extend?: any;
          failureCount: number;
          groupId: string;
          lastFailureAt?: number;
          lastSuccessAt?: number;
          secretHash: string;
          status: "active" | "disabled";
          subscriptions: Array<string>;
          url: string;
        }>,
        Name
      >;
      groupWebhookEndpointUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; endpointId: string },
        null,
        Name
      >;
      identity: {
        accounts: {
          accountDelete: FunctionReference<
            "mutation",
            "internal",
            { accountId: string; requireOtherAccount?: boolean },
            null,
            Name
          >;
          accountGet: FunctionReference<
            "query",
            "internal",
            { id?: string; provider?: string; providerAccountId?: string },
            {
              _creationTime: number;
              _id: string;
              emailVerified?: string;
              extend?: any;
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
              extend?: any;
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
              extend?: any;
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
        };
        codes: {
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
          verificationCodeGet: FunctionReference<
            "query",
            "internal",
            { accountId?: string; code?: string },
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
        };
        sessions: {
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
          sessionIssue: FunctionReference<
            "mutation",
            "internal",
            {
              refreshTokenExpirationTime?: number;
              replaceSessionId?: string;
              sessionExpirationTime: number;
              sessionId?: string;
              userId: string;
            },
            { refreshTokenId?: string; sessionId: string; userId: string },
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
        };
        tokens: {
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
          refreshTokenExchange: FunctionReference<
            "mutation",
            "internal",
            {
              now: number;
              refreshTokenExpirationTime: number;
              refreshTokenId: string;
              reuseWindowMs: number;
              sessionId: string;
            },
            {
              refreshTokenId: string;
              sessionId: string;
              userId: string;
            } | null,
            Name
          >;
          refreshTokenGet: FunctionReference<
            "query",
            "internal",
            { activeForSession?: string; id?: string },
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
        };
        users: {
          userDelete: FunctionReference<
            "mutation",
            "internal",
            { cascade?: boolean; userId: string },
            null,
            Name
          >;
          userEmailFindVerified: FunctionReference<
            "query",
            "internal",
            { connectionId?: string; email: string },
            {
              _creationTime: number;
              _id: string;
              email?: string;
              emailVerificationTime?: number;
              extend?: any;
              hasTotp?: boolean;
              image?: string;
              isAnonymous?: boolean;
              lastActiveGroup?: string;
              name?: string;
              phone?: string;
              phoneVerificationTime?: number;
            } | null,
            Name
          >;
          userEmailListByUser: FunctionReference<
            "query",
            "internal",
            { userId: string },
            Array<{
              _creationTime: number;
              _id: string;
              accountId?: string;
              connectionId?: string;
              email: string;
              isPrimary: boolean;
              provider?: string;
              source: "password" | "oauth" | "oidc" | "saml" | "scim";
              userId: string;
              verificationTime?: number;
            }>,
            Name
          >;
          userEmailRemove: FunctionReference<
            "mutation",
            "internal",
            { email: string; userId: string },
            null,
            Name
          >;
          userEmailSetPrimary: FunctionReference<
            "mutation",
            "internal",
            { email: string; userId: string },
            null,
            Name
          >;
          userEmailUpsert: FunctionReference<
            "mutation",
            "internal",
            {
              accountId?: string;
              connectionId?: string;
              email: string;
              isPrimary?: boolean;
              provider?: string;
              source: "password" | "oauth" | "oidc" | "saml" | "scim";
              userId: string;
              verified?: boolean;
            },
            string,
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
                hasTotp?: boolean;
                image?: string;
                isAnonymous?: boolean;
                lastActiveGroup?: string;
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
        };
        verifiers: {
          verifierCreate: FunctionReference<
            "mutation",
            "internal",
            { expirationTime?: number; sessionId?: string; signature?: string },
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
          verifierGet: FunctionReference<
            "query",
            "internal",
            { id?: string; signature?: string },
            {
              _creationTime: number;
              _id: string;
              expirationTime?: number;
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
      passkeyGetById: FunctionReference<
        "query",
        "internal",
        { passkeyId: string },
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
      security: {
        keys: {
          keyDelete: FunctionReference<
            "mutation",
            "internal",
            { keyId: string },
            null,
            Name
          >;
          keyGet: FunctionReference<
            "query",
            "internal",
            { hashedKey?: string; id?: string },
            {
              _creationTime: number;
              _id: string;
              createdAt: number;
              expiresAt?: number;
              hashedKey: string;
              lastUsedAt?: number;
              metadata?: any;
              name: string;
              prefix: string;
              rateLimit?: { maxRequests: number; windowMs: number };
              rateLimitState?: {
                attemptsLeft: number;
                lastAttemptTime: number;
              };
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
              metadata?: any;
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
                metadata?: any;
                name: string;
                prefix: string;
                rateLimit?: { maxRequests: number; windowMs: number };
                rateLimitState?: {
                  attemptsLeft: number;
                  lastAttemptTime: number;
                };
                revoked: boolean;
                scopes: Array<{ actions: Array<string>; resource: string }>;
                userId: string;
              }>;
              nextCursor: string | null;
            },
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
                rateLimitState?: {
                  attemptsLeft: number;
                  lastAttemptTime: number;
                };
                revoked?: boolean;
                scopes?: Array<{ actions: Array<string>; resource: string }>;
              };
              keyId: string;
            },
            null,
            Name
          >;
        };
        limits: {
          rateLimitCreate: FunctionReference<
            "mutation",
            "internal",
            {
              attemptsLeft: number;
              identifier: string;
              lastAttemptTime: number;
            },
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
        };
      };
      sso: {
        audit: {
          groupAuditEventCreate: FunctionReference<
            "mutation",
            "internal",
            {
              actorId?: string;
              actorType: "user" | "system" | "scim" | "api_key" | "webhook";
              connectionId?: string;
              eventType: string;
              groupId: string;
              ip?: string;
              metadata?: any;
              occurredAt: number;
              requestId?: string;
              status: "success" | "failure";
              subjectId?: string;
              subjectType: string;
            },
            string,
            Name
          >;
          groupAuditEventList: FunctionReference<
            "query",
            "internal",
            { connectionId?: string; groupId?: string; limit?: number },
            Array<{
              _creationTime: number;
              _id: string;
              actorId?: string;
              actorType: "user" | "system" | "scim" | "api_key" | "webhook";
              connectionId?: string;
              eventType: string;
              groupId: string;
              ip?: string;
              metadata?: any;
              occurredAt: number;
              requestId?: string;
              status: "success" | "failure";
              subjectId?: string;
              subjectType: string;
            }>,
            Name
          >;
        };
        core: {
          groupConnectionCreate: FunctionReference<
            "mutation",
            "internal",
            {
              config?: any;
              extend?: any;
              groupId: string;
              name?: string;
              protocol: "oidc" | "saml";
              slug?: string;
              status?: "draft" | "active" | "disabled";
            },
            string,
            Name
          >;
          groupConnectionDelete: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string },
            null,
            Name
          >;
          groupConnectionGet: FunctionReference<
            "query",
            "internal",
            { connectionId: string },
            {
              _creationTime: number;
              _id: string;
              config?: any;
              extend?: any;
              groupId: string;
              name?: string;
              protocol: "oidc" | "saml";
              slug?: string;
              status: "draft" | "active" | "disabled";
            } | null,
            Name
          >;
          groupConnectionGetByDomain: FunctionReference<
            "query",
            "internal",
            { domain: string },
            {
              connection: {
                _creationTime: number;
                _id: string;
                config?: any;
                extend?: any;
                groupId: string;
                name?: string;
                protocol: "oidc" | "saml";
                slug?: string;
                status: "draft" | "active" | "disabled";
              };
              domain: {
                _creationTime: number;
                _id: string;
                connectionId: string;
                domain: string;
                groupId: string;
                isPrimary: boolean;
                verifiedAt?: number;
              };
            } | null,
            Name
          >;
          groupConnectionList: FunctionReference<
            "query",
            "internal",
            {
              cursor?: string | null;
              limit?: number;
              order?: "asc" | "desc";
              orderBy?: "_creationTime" | "name" | "slug" | "status";
              where?: {
                groupId?: string;
                slug?: string;
                status?: "draft" | "active" | "disabled";
              };
            },
            {
              items: Array<{
                _creationTime: number;
                _id: string;
                config?: any;
                extend?: any;
                groupId: string;
                name?: string;
                protocol: "oidc" | "saml";
                slug?: string;
                status: "draft" | "active" | "disabled";
              }>;
              nextCursor: string | null;
            },
            Name
          >;
          groupConnectionUpdate: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string; data: any },
            null,
            Name
          >;
        };
        domains: {
          groupConnectionDomainAdd: FunctionReference<
            "mutation",
            "internal",
            {
              connectionId: string;
              domain: string;
              groupId: string;
              isPrimary?: boolean;
            },
            string,
            Name
          >;
          groupConnectionDomainDelete: FunctionReference<
            "mutation",
            "internal",
            { domainId: string },
            null,
            Name
          >;
          groupConnectionDomainList: FunctionReference<
            "query",
            "internal",
            { connectionId: string; limit?: number },
            Array<{
              _creationTime: number;
              _id: string;
              connectionId: string;
              domain: string;
              groupId: string;
              isPrimary: boolean;
              verifiedAt?: number;
            }>,
            Name
          >;
          groupConnectionDomainVerificationDelete: FunctionReference<
            "mutation",
            "internal",
            { domainId: string },
            null,
            Name
          >;
          groupConnectionDomainVerificationGet: FunctionReference<
            "query",
            "internal",
            { domainId: string },
            {
              _creationTime: number;
              _id: string;
              connectionId: string;
              domain: string;
              domainId: string;
              expiresAt: number;
              groupId: string;
              recordName: string;
              requestedAt: number;
              token: string;
              tokenHash: string;
            } | null,
            Name
          >;
          groupConnectionDomainVerificationUpsert: FunctionReference<
            "mutation",
            "internal",
            {
              connectionId: string;
              domain: string;
              domainId: string;
              expiresAt: number;
              groupId: string;
              recordName: string;
              requestedAt: number;
              token: string;
              tokenHash: string;
            },
            string,
            Name
          >;
          groupConnectionDomainVerify: FunctionReference<
            "mutation",
            "internal",
            { domainId: string; verifiedAt: number },
            {
              _creationTime: number;
              _id: string;
              connectionId: string;
              domain: string;
              groupId: string;
              isPrimary: boolean;
              verifiedAt?: number;
            },
            Name
          >;
        };
        scim: {
          groupConnectionScimConfigGetByGroupConnection: FunctionReference<
            "query",
            "internal",
            { connectionId: string },
            {
              _creationTime: number;
              _id: string;
              basePath: string;
              connectionId: string;
              extend?: any;
              groupId: string;
              lastRotatedAt?: number;
              status: "draft" | "active" | "disabled";
              tokenHash: string;
            } | null,
            Name
          >;
          groupConnectionScimConfigGetByTokenHash: FunctionReference<
            "query",
            "internal",
            { tokenHash: string },
            {
              _creationTime: number;
              _id: string;
              basePath: string;
              connectionId: string;
              extend?: any;
              groupId: string;
              lastRotatedAt?: number;
              status: "draft" | "active" | "disabled";
              tokenHash: string;
            } | null,
            Name
          >;
          groupConnectionScimConfigUpsert: FunctionReference<
            "mutation",
            "internal",
            {
              basePath: string;
              connectionId: string;
              extend?: any;
              groupId: string;
              lastRotatedAt?: number;
              status: "draft" | "active" | "disabled";
              tokenHash: string;
            },
            string,
            Name
          >;
          groupConnectionScimIdentityDelete: FunctionReference<
            "mutation",
            "internal",
            { identityId: string },
            null,
            Name
          >;
          groupConnectionScimIdentityGet: FunctionReference<
            "query",
            "internal",
            {
              connectionId: string;
              externalId: string;
              resourceType: "user" | "group";
            },
            {
              _creationTime: number;
              _id: string;
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            } | null,
            Name
          >;
          groupConnectionScimIdentityGetByGroupConnectionAndUser: FunctionReference<
            "query",
            "internal",
            { connectionId: string; userId: string },
            {
              _creationTime: number;
              _id: string;
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            } | null,
            Name
          >;
          groupConnectionScimIdentityGetByGroupConnectionAndUsers: FunctionReference<
            "query",
            "internal",
            { connectionId: string; userIds: Array<string> },
            Array<{
              identity: {
                _creationTime: number;
                _id: string;
                active?: boolean;
                connectionId: string;
                externalId: string;
                groupId: string;
                lastProvisionedAt?: number;
                mappedGroupId?: string;
                raw?: any;
                resourceType: "user" | "group";
                userId?: string;
              } | null;
              userId: string;
            }>,
            Name
          >;
          groupConnectionScimIdentityGetByMappedGroup: FunctionReference<
            "query",
            "internal",
            { mappedGroupId: string },
            {
              _creationTime: number;
              _id: string;
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            } | null,
            Name
          >;
          groupConnectionScimIdentityGetByUser: FunctionReference<
            "query",
            "internal",
            { userId: string },
            {
              _creationTime: number;
              _id: string;
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            } | null,
            Name
          >;
          groupConnectionScimIdentityListByGroupConnection: FunctionReference<
            "query",
            "internal",
            { connectionId: string },
            Array<{
              _creationTime: number;
              _id: string;
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            }>,
            Name
          >;
          groupConnectionScimIdentityUpsert: FunctionReference<
            "mutation",
            "internal",
            {
              active?: boolean;
              connectionId: string;
              externalId: string;
              groupId: string;
              lastProvisionedAt?: number;
              mappedGroupId?: string;
              raw?: any;
              resourceType: "user" | "group";
              userId?: string;
            },
            string,
            Name
          >;
        };
        secrets: {
          groupConnectionSecretDelete: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string; kind: "oidc_client_secret" },
            null,
            Name
          >;
          groupConnectionSecretGet: FunctionReference<
            "query",
            "internal",
            { connectionId: string; kind: "oidc_client_secret" },
            {
              _creationTime: number;
              _id: string;
              ciphertext: string;
              connectionId: string;
              groupId: string;
              kind: "oidc_client_secret";
              updatedAt: number;
            } | null,
            Name
          >;
          groupConnectionSecretUpsert: FunctionReference<
            "mutation",
            "internal",
            {
              ciphertext: string;
              connectionId: string;
              groupId: string;
              kind: "oidc_client_secret";
              updatedAt: number;
            },
            string,
            Name
          >;
        };
        webhooks: {
          groupWebhookDeliveryEnqueue: FunctionReference<
            "mutation",
            "internal",
            {
              auditEventId?: string;
              connectionId: string;
              endpointId: string;
              eventType: string;
              nextAttemptAt: number;
              payload: any;
            },
            string,
            Name
          >;
          groupWebhookDeliveryList: FunctionReference<
            "query",
            "internal",
            { connectionId: string; limit?: number },
            Array<{
              _creationTime: number;
              _id: string;
              attemptCount: number;
              auditEventId?: string;
              connectionId: string;
              endpointId: string;
              eventType: string;
              lastAttemptAt?: number;
              lastError?: string;
              lastResponseStatus?: number;
              nextAttemptAt: number;
              payload: any;
              status: "pending" | "processing" | "delivered" | "failed";
            }>,
            Name
          >;
          groupWebhookDeliveryListReady: FunctionReference<
            "query",
            "internal",
            { limit?: number; now: number },
            Array<{
              _creationTime: number;
              _id: string;
              attemptCount: number;
              auditEventId?: string;
              connectionId: string;
              endpointId: string;
              eventType: string;
              lastAttemptAt?: number;
              lastError?: string;
              lastResponseStatus?: number;
              nextAttemptAt: number;
              payload: any;
              status: "pending" | "processing" | "delivered" | "failed";
            }>,
            Name
          >;
          groupWebhookDeliveryPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; deliveryId: string },
            null,
            Name
          >;
          groupWebhookEndpointCreate: FunctionReference<
            "mutation",
            "internal",
            {
              connectionId: string;
              createdByUserId?: string;
              extend?: any;
              groupId: string;
              secretHash: string;
              status?: "active" | "disabled";
              subscriptions: Array<string>;
              url: string;
            },
            string,
            Name
          >;
          groupWebhookEndpointGet: FunctionReference<
            "query",
            "internal",
            { endpointId: string },
            {
              _creationTime: number;
              _id: string;
              connectionId: string;
              createdByUserId?: string;
              extend?: any;
              failureCount: number;
              groupId: string;
              lastFailureAt?: number;
              lastSuccessAt?: number;
              secretHash: string;
              status: "active" | "disabled";
              subscriptions: Array<string>;
              url: string;
            } | null,
            Name
          >;
          groupWebhookEndpointList: FunctionReference<
            "query",
            "internal",
            { connectionId: string },
            Array<{
              _creationTime: number;
              _id: string;
              connectionId: string;
              createdByUserId?: string;
              extend?: any;
              failureCount: number;
              groupId: string;
              lastFailureAt?: number;
              lastSuccessAt?: number;
              secretHash: string;
              status: "active" | "disabled";
              subscriptions: Array<string>;
              url: string;
            }>,
            Name
          >;
          groupWebhookEndpointUpdate: FunctionReference<
            "mutation",
            "internal",
            { data: any; endpointId: string },
            null,
            Name
          >;
        };
      };
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
    };
    rateLimit: {
      create: FunctionReference<
        "mutation",
        "internal",
        { attemptsLeft: number; identifier: string; lastAttemptTime: number },
        string,
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { rateLimitId: string },
        null,
        Name
      >;
      get: FunctionReference<
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
      update: FunctionReference<
        "mutation",
        "internal",
        { data: any; rateLimitId: string },
        null,
        Name
      >;
    };
    refreshToken: {
      create: FunctionReference<
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
      delete: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null,
        Name
      >;
      exchange: FunctionReference<
        "mutation",
        "internal",
        {
          now: number;
          refreshTokenExpirationTime: number;
          refreshTokenId: string;
          reuseWindowMs: number;
          sessionId: string;
        },
        { refreshTokenId: string; sessionId: string; userId: string } | null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { activeForSession?: string; id?: string },
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
      list: FunctionReference<
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
      listChildren: FunctionReference<
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
      update: FunctionReference<
        "mutation",
        "internal",
        { data: any; refreshTokenId: string },
        null,
        Name
      >;
    };
    session: {
      create: FunctionReference<
        "mutation",
        "internal",
        { expirationTime: number; userId: string },
        string,
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null,
        Name
      >;
      get: FunctionReference<
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
      issue: FunctionReference<
        "mutation",
        "internal",
        {
          refreshTokenExpirationTime?: number;
          replaceSessionId?: string;
          sessionExpirationTime: number;
          sessionId?: string;
          userId: string;
        },
        { refreshTokenId?: string; sessionId: string; userId: string },
        Name
      >;
      list: FunctionReference<
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
      listByUser: FunctionReference<
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
    };
    user: {
      create: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        string,
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { cascade?: boolean; userId: string },
        null,
        Name
      >;
      email: {
        delete: FunctionReference<
          "mutation",
          "internal",
          { email: string; userId: string },
          null,
          Name
        >;
        findOwner: FunctionReference<
          "query",
          "internal",
          { connectionId?: string; email: string },
          {
            _creationTime: number;
            _id: string;
            email?: string;
            emailVerificationTime?: number;
            extend?: any;
            hasTotp?: boolean;
            image?: string;
            isAnonymous?: boolean;
            lastActiveGroup?: string;
            name?: string;
            phone?: string;
            phoneVerificationTime?: number;
          } | null,
          Name
        >;
        list: FunctionReference<
          "query",
          "internal",
          { userId: string },
          Array<{
            _creationTime: number;
            _id: string;
            accountId?: string;
            connectionId?: string;
            email: string;
            isPrimary: boolean;
            provider?: string;
            source: "password" | "oauth" | "oidc" | "saml" | "scim";
            userId: string;
            verificationTime?: number;
          }>,
          Name
        >;
        setPrimary: FunctionReference<
          "mutation",
          "internal",
          { email: string; userId: string },
          null,
          Name
        >;
        upsert: FunctionReference<
          "mutation",
          "internal",
          {
            accountId?: string;
            connectionId?: string;
            email: string;
            isPrimary?: boolean;
            provider?: string;
            source: "password" | "oauth" | "oidc" | "saml" | "scim";
            userId: string;
            verified?: boolean;
          },
          string,
          Name
        >;
      };
      get: FunctionReference<
        "query",
        "internal",
        {
          id?: string;
          ids?: Array<string>;
          verifiedEmail?: string;
          verifiedPhone?: string;
        },
        | {
            _creationTime: number;
            _id: string;
            email?: string;
            emailVerificationTime?: number;
            extend?: any;
            hasTotp?: boolean;
            image?: string;
            isAnonymous?: boolean;
            lastActiveGroup?: string;
            name?: string;
            phone?: string;
            phoneVerificationTime?: number;
          }
        | null
        | Array<{
            _creationTime: number;
            _id: string;
            email?: string;
            emailVerificationTime?: number;
            extend?: any;
            hasTotp?: boolean;
            image?: string;
            isAnonymous?: boolean;
            lastActiveGroup?: string;
            name?: string;
            phone?: string;
            phoneVerificationTime?: number;
          } | null>,
        Name
      >;
      key: {
        create: FunctionReference<
          "mutation",
          "internal",
          {
            expiresAt?: number;
            hashedKey: string;
            metadata?: any;
            name: string;
            prefix: string;
            rateLimit?: { maxRequests: number; windowMs: number };
            scopes: Array<{ actions: Array<string>; resource: string }>;
            userId: string;
          },
          string,
          Name
        >;
        delete: FunctionReference<
          "mutation",
          "internal",
          { keyId: string },
          null,
          Name
        >;
        get: FunctionReference<
          "query",
          "internal",
          { hashedKey?: string; id?: string },
          {
            _creationTime: number;
            _id: string;
            createdAt: number;
            expiresAt?: number;
            hashedKey: string;
            lastUsedAt?: number;
            metadata?: any;
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
        list: FunctionReference<
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
              metadata?: any;
              name: string;
              prefix: string;
              rateLimit?: { maxRequests: number; windowMs: number };
              rateLimitState?: {
                attemptsLeft: number;
                lastAttemptTime: number;
              };
              revoked: boolean;
              scopes: Array<{ actions: Array<string>; resource: string }>;
              userId: string;
            }>;
            nextCursor: string | null;
          },
          Name
        >;
        update: FunctionReference<
          "mutation",
          "internal",
          {
            data: {
              lastUsedAt?: number;
              name?: string;
              rateLimit?: { maxRequests: number; windowMs: number };
              rateLimitState?: {
                attemptsLeft: number;
                lastAttemptTime: number;
              };
              revoked?: boolean;
              scopes?: Array<{ actions: Array<string>; resource: string }>;
            };
            keyId: string;
          },
          null,
          Name
        >;
      };
      list: FunctionReference<
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
            hasTotp?: boolean;
            image?: string;
            isAnonymous?: boolean;
            lastActiveGroup?: string;
            name?: string;
            phone?: string;
            phoneVerificationTime?: number;
          }>;
          nextCursor: string | null;
        },
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId: string },
        null,
        Name
      >;
      upsert: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId?: string },
        string,
        Name
      >;
    };
    verificationCode: {
      create: FunctionReference<
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
      delete: FunctionReference<
        "mutation",
        "internal",
        { verificationCodeId: string },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { accountId?: string; code?: string },
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
    };
    verifier: {
      create: FunctionReference<
        "mutation",
        "internal",
        { expirationTime?: number; sessionId?: string; signature?: string },
        string,
        Name
      >;
      delete: FunctionReference<
        "mutation",
        "internal",
        { verifierId: string },
        null,
        Name
      >;
      get: FunctionReference<
        "query",
        "internal",
        { id?: string; signature?: string },
        {
          _creationTime: number;
          _id: string;
          expirationTime?: number;
          sessionId?: string;
          signature?: string;
        } | null,
        Name
      >;
      update: FunctionReference<
        "mutation",
        "internal",
        { data: any; verifierId: string },
        null,
        Name
      >;
    };
  };
