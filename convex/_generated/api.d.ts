/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as auth from "../auth.js";
import type * as auth_core from "../auth/core.js";
import type * as auth_group from "../auth/group.js";
import type * as comments from "../comments.js";
import type * as functions from "../functions.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as issues from "../issues.js";
import type * as projects from "../projects.js";
import type * as roles from "../roles.js";
import type * as shared from "../shared.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  auth: typeof auth;
  "auth/core": typeof auth_core;
  "auth/group": typeof auth_group;
  comments: typeof comments;
  functions: typeof functions;
  groups: typeof groups;
  http: typeof http;
  issues: typeof issues;
  projects: typeof projects;
  roles: typeof roles;
  shared: typeof shared;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  auth: {
    public: {
      accountDelete: FunctionReference<
        "mutation",
        "internal",
        { accountId: string },
        null
      >;
      accountGet: FunctionReference<
        "query",
        "internal",
        { provider: string; providerAccountId: string },
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
        } | null
      >;
      accountGetById: FunctionReference<
        "query",
        "internal",
        { accountId: string },
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
        } | null
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
        string
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
        }>
      >;
      accountPatch: FunctionReference<
        "mutation",
        "internal",
        { accountId: string; data: any },
        null
      >;
      deviceAuthorize: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string; sessionId: string; userId: string },
        null
      >;
      deviceDelete: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string },
        null
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
        } | null
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
        } | null
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
        string
      >;
      deviceUpdateLastPolled: FunctionReference<
        "mutation",
        "internal",
        { deviceId: string; lastPolledAt: number },
        null
      >;
      factors: {
        devices: {
          deviceAuthorize: FunctionReference<
            "mutation",
            "internal",
            { deviceId: string; sessionId: string; userId: string },
            null
          >;
          deviceDelete: FunctionReference<
            "mutation",
            "internal",
            { deviceId: string },
            null
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
            } | null
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
            } | null
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
            string
          >;
          deviceUpdateLastPolled: FunctionReference<
            "mutation",
            "internal",
            { deviceId: string; lastPolledAt: number },
            null
          >;
        };
        passkeys: {
          passkeyDelete: FunctionReference<
            "mutation",
            "internal",
            { passkeyId: string },
            null
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
            } | null
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
            string
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
            }>
          >;
          passkeyUpdateCounter: FunctionReference<
            "mutation",
            "internal",
            { counter: number; lastUsedAt: number; passkeyId: string },
            null
          >;
          passkeyUpdateMeta: FunctionReference<
            "mutation",
            "internal",
            { data: any; passkeyId: string },
            null
          >;
        };
        totp: {
          totpDelete: FunctionReference<
            "mutation",
            "internal",
            { totpId: string },
            null
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
            } | null
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
            } | null
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
            string
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
            }>
          >;
          totpMarkVerified: FunctionReference<
            "mutation",
            "internal",
            { lastUsedAt: number; totpId: string },
            null
          >;
          totpUpdateLastUsed: FunctionReference<
            "mutation",
            "internal",
            { lastUsedAt: number; totpId: string },
            null
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
        string
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
        }>
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
        string
      >;
      groupConnectionDelete: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string },
        null
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
        string
      >;
      groupConnectionDomainDelete: FunctionReference<
        "mutation",
        "internal",
        { domainId: string },
        null
      >;
      groupConnectionDomainList: FunctionReference<
        "query",
        "internal",
        { connectionId: string },
        Array<{
          _creationTime: number;
          _id: string;
          connectionId: string;
          domain: string;
          groupId: string;
          isPrimary: boolean;
          verifiedAt?: number;
        }>
      >;
      groupConnectionDomainVerificationDelete: FunctionReference<
        "mutation",
        "internal",
        { domainId: string },
        null
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
        } | null
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
        string
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
        }
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
        } | null
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
        } | null
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
        }
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
        } | null
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
        } | null
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
        string
      >;
      groupConnectionScimIdentityDelete: FunctionReference<
        "mutation",
        "internal",
        { identityId: string },
        null
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
        } | null
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
        } | null
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
        } | null
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
        } | null
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
        }>
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
        string
      >;
      groupConnectionSecretDelete: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string; kind: "oidc_client_secret" },
        null
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
        } | null
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
        string
      >;
      groupConnectionUpdate: FunctionReference<
        "mutation",
        "internal",
        { connectionId: string; data: any },
        null
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
        string
      >;
      groupDelete: FunctionReference<
        "mutation",
        "internal",
        { groupId: string },
        null
      >;
      groupGet: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        {
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
                oidc: "verifiedEmail" | "none";
                saml: "verifiedEmail" | "none";
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
        } | null
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
                  oidc: "verifiedEmail" | "none";
                  saml: "verifiedEmail" | "none";
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
        }
      >;
      groups: {
        core: {
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
            string
          >;
          groupDelete: FunctionReference<
            "mutation",
            "internal",
            { groupId: string },
            null
          >;
          groupGet: FunctionReference<
            "query",
            "internal",
            { groupId: string },
            {
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
                    oidc: "verifiedEmail" | "none";
                    saml: "verifiedEmail" | "none";
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
            } | null
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
                      oidc: "verifiedEmail" | "none";
                      saml: "verifiedEmail" | "none";
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
            }
          >;
          groupUpdate: FunctionReference<
            "mutation",
            "internal",
            { data: any; groupId: string },
            null
          >;
        };
        invites: {
          inviteAccept: FunctionReference<
            "mutation",
            "internal",
            { acceptedByUserId?: string; inviteId: string },
            null
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
            }
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
            string
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
              roleIds?: Array<string>;
              status: "pending" | "accepted" | "revoked" | "expired";
              tokenHash: string;
            } | null
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
              roleIds?: Array<string>;
              status: "pending" | "accepted" | "revoked" | "expired";
              tokenHash: string;
            } | null
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
            }
          >;
          inviteRevoke: FunctionReference<
            "mutation",
            "internal",
            { inviteId: string },
            null
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
            string
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
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            } | null
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
              roleIds?: Array<string>;
              status?: string;
              userId: string;
            } | null
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
            }
          >;
          memberRemove: FunctionReference<
            "mutation",
            "internal",
            { memberId: string },
            null
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
            }
          >;
          memberUpdate: FunctionReference<
            "mutation",
            "internal",
            { data: any; memberId: string },
            null
          >;
        };
      };
      groupUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; groupId: string },
        null
      >;
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
        string
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
        }>
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
        }>
      >;
      groupWebhookDeliveryPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; deliveryId: string },
        null
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
        string
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
        } | null
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
        }>
      >;
      groupWebhookEndpointUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; endpointId: string },
        null
      >;
      identity: {
        accounts: {
          accountDelete: FunctionReference<
            "mutation",
            "internal",
            { accountId: string },
            null
          >;
          accountGet: FunctionReference<
            "query",
            "internal",
            { provider: string; providerAccountId: string },
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
            } | null
          >;
          accountGetById: FunctionReference<
            "query",
            "internal",
            { accountId: string },
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
            } | null
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
            string
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
            }>
          >;
          accountPatch: FunctionReference<
            "mutation",
            "internal",
            { accountId: string; data: any },
            null
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
            string
          >;
          verificationCodeDelete: FunctionReference<
            "mutation",
            "internal",
            { verificationCodeId: string },
            null
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
            } | null
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
            } | null
          >;
        };
        sessions: {
          sessionCreate: FunctionReference<
            "mutation",
            "internal",
            { expirationTime: number; userId: string },
            string
          >;
          sessionDelete: FunctionReference<
            "mutation",
            "internal",
            { sessionId: string },
            null
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
            } | null
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
            { refreshTokenId?: string; sessionId: string; userId: string }
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
            }
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
            }>
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
            string
          >;
          refreshTokenDeleteAll: FunctionReference<
            "mutation",
            "internal",
            { sessionId: string },
            null
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
            { refreshTokenId: string; sessionId: string; userId: string } | null
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
            } | null
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
            } | null
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
            }>
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
            }>
          >;
          refreshTokenPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; refreshTokenId: string },
            null
          >;
        };
        users: {
          userDelete: FunctionReference<
            "mutation",
            "internal",
            { userId: string },
            null
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
            } | null
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
            } | null
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
            } | null
          >;
          userInsert: FunctionReference<
            "mutation",
            "internal",
            { data: any },
            string
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
            }
          >;
          userPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; userId: string },
            null
          >;
          userUpsert: FunctionReference<
            "mutation",
            "internal",
            { data: any; userId?: string },
            string
          >;
        };
        verifiers: {
          verifierCreate: FunctionReference<
            "mutation",
            "internal",
            { sessionId?: string; signature?: string },
            string
          >;
          verifierDelete: FunctionReference<
            "mutation",
            "internal",
            { verifierId: string },
            null
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
            } | null
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
            } | null
          >;
          verifierPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; verifierId: string },
            null
          >;
        };
      };
      inviteAccept: FunctionReference<
        "mutation",
        "internal",
        { acceptedByUserId?: string; inviteId: string },
        null
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
        }
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
        string
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
          roleIds?: Array<string>;
          status: "pending" | "accepted" | "revoked" | "expired";
          tokenHash: string;
        } | null
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
          roleIds?: Array<string>;
          status: "pending" | "accepted" | "revoked" | "expired";
          tokenHash: string;
        } | null
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
        }
      >;
      inviteRevoke: FunctionReference<
        "mutation",
        "internal",
        { inviteId: string },
        null
      >;
      keyDelete: FunctionReference<
        "mutation",
        "internal",
        { keyId: string },
        null
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
          metadata?: any;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
          revoked: boolean;
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        } | null
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
          metadata?: any;
          name: string;
          prefix: string;
          rateLimit?: { maxRequests: number; windowMs: number };
          rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
          revoked: boolean;
          scopes: Array<{ actions: Array<string>; resource: string }>;
          userId: string;
        } | null
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
        string
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
            rateLimitState?: { attemptsLeft: number; lastAttemptTime: number };
            revoked: boolean;
            scopes: Array<{ actions: Array<string>; resource: string }>;
            userId: string;
          }>;
          nextCursor: string | null;
        }
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
        null
      >;
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
        string
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
          roleIds?: Array<string>;
          status?: string;
          userId: string;
        } | null
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
          roleIds?: Array<string>;
          status?: string;
          userId: string;
        } | null
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
        }
      >;
      memberRemove: FunctionReference<
        "mutation",
        "internal",
        { memberId: string },
        null
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
        }
      >;
      memberUpdate: FunctionReference<
        "mutation",
        "internal",
        { data: any; memberId: string },
        null
      >;
      passkeyDelete: FunctionReference<
        "mutation",
        "internal",
        { passkeyId: string },
        null
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
        } | null
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
        string
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
        }>
      >;
      passkeyUpdateCounter: FunctionReference<
        "mutation",
        "internal",
        { counter: number; lastUsedAt: number; passkeyId: string },
        null
      >;
      passkeyUpdateMeta: FunctionReference<
        "mutation",
        "internal",
        { data: any; passkeyId: string },
        null
      >;
      rateLimitCreate: FunctionReference<
        "mutation",
        "internal",
        { attemptsLeft: number; identifier: string; lastAttemptTime: number },
        string
      >;
      rateLimitDelete: FunctionReference<
        "mutation",
        "internal",
        { rateLimitId: string },
        null
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
        } | null
      >;
      rateLimitPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; rateLimitId: string },
        null
      >;
      refreshTokenCreate: FunctionReference<
        "mutation",
        "internal",
        {
          expirationTime: number;
          parentRefreshTokenId?: string;
          sessionId: string;
        },
        string
      >;
      refreshTokenDeleteAll: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null
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
        { refreshTokenId: string; sessionId: string; userId: string } | null
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
        } | null
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
        } | null
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
        }>
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
        }>
      >;
      refreshTokenPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; refreshTokenId: string },
        null
      >;
      security: {
        keys: {
          keyDelete: FunctionReference<
            "mutation",
            "internal",
            { keyId: string },
            null
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
            } | null
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
            } | null
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
            string
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
            }
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
            null
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
            string
          >;
          rateLimitDelete: FunctionReference<
            "mutation",
            "internal",
            { rateLimitId: string },
            null
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
            } | null
          >;
          rateLimitPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; rateLimitId: string },
            null
          >;
        };
      };
      sessionCreate: FunctionReference<
        "mutation",
        "internal",
        { expirationTime: number; userId: string },
        string
      >;
      sessionDelete: FunctionReference<
        "mutation",
        "internal",
        { sessionId: string },
        null
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
        } | null
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
        { refreshTokenId?: string; sessionId: string; userId: string }
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
        }
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
        }>
      >;
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
            string
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
            }>
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
            string
          >;
          groupConnectionDelete: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string },
            null
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
            } | null
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
            } | null
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
            }
          >;
          groupConnectionUpdate: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string; data: any },
            null
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
            string
          >;
          groupConnectionDomainDelete: FunctionReference<
            "mutation",
            "internal",
            { domainId: string },
            null
          >;
          groupConnectionDomainList: FunctionReference<
            "query",
            "internal",
            { connectionId: string },
            Array<{
              _creationTime: number;
              _id: string;
              connectionId: string;
              domain: string;
              groupId: string;
              isPrimary: boolean;
              verifiedAt?: number;
            }>
          >;
          groupConnectionDomainVerificationDelete: FunctionReference<
            "mutation",
            "internal",
            { domainId: string },
            null
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
            } | null
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
            string
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
            }
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
            } | null
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
            } | null
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
            string
          >;
          groupConnectionScimIdentityDelete: FunctionReference<
            "mutation",
            "internal",
            { identityId: string },
            null
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
            } | null
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
            } | null
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
            } | null
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
            } | null
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
            }>
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
            string
          >;
        };
        secrets: {
          groupConnectionSecretDelete: FunctionReference<
            "mutation",
            "internal",
            { connectionId: string; kind: "oidc_client_secret" },
            null
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
            } | null
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
            string
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
            string
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
            }>
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
            }>
          >;
          groupWebhookDeliveryPatch: FunctionReference<
            "mutation",
            "internal",
            { data: any; deliveryId: string },
            null
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
            string
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
            } | null
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
            }>
          >;
          groupWebhookEndpointUpdate: FunctionReference<
            "mutation",
            "internal",
            { data: any; endpointId: string },
            null
          >;
        };
      };
      totpDelete: FunctionReference<
        "mutation",
        "internal",
        { totpId: string },
        null
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
        } | null
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
        } | null
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
        string
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
        }>
      >;
      totpMarkVerified: FunctionReference<
        "mutation",
        "internal",
        { lastUsedAt: number; totpId: string },
        null
      >;
      totpUpdateLastUsed: FunctionReference<
        "mutation",
        "internal",
        { lastUsedAt: number; totpId: string },
        null
      >;
      userDelete: FunctionReference<
        "mutation",
        "internal",
        { userId: string },
        null
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
        } | null
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
        } | null
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
        } | null
      >;
      userInsert: FunctionReference<
        "mutation",
        "internal",
        { data: any },
        string
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
        }
      >;
      userPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId: string },
        null
      >;
      userUpsert: FunctionReference<
        "mutation",
        "internal",
        { data: any; userId?: string },
        string
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
        string
      >;
      verificationCodeDelete: FunctionReference<
        "mutation",
        "internal",
        { verificationCodeId: string },
        null
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
        } | null
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
        } | null
      >;
      verifierCreate: FunctionReference<
        "mutation",
        "internal",
        { sessionId?: string; signature?: string },
        string
      >;
      verifierDelete: FunctionReference<
        "mutation",
        "internal",
        { verifierId: string },
        null
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
        } | null
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
        } | null
      >;
      verifierPatch: FunctionReference<
        "mutation",
        "internal",
        { data: any; verifierId: string },
        null
      >;
    };
  };
  resend: {
    lib: {
      cancelEmail: FunctionReference<
        "mutation",
        "internal",
        { emailId: string },
        null
      >;
      cleanupAbandonedEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null
      >;
      cleanupOldEmails: FunctionReference<
        "mutation",
        "internal",
        { olderThan?: number },
        null
      >;
      createManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          from: string;
          headers?: Array<{ name: string; value: string }>;
          replyTo?: Array<string>;
          subject: string;
          to: Array<string> | string;
        },
        string
      >;
      get: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bcc?: Array<string>;
          bounced?: boolean;
          cc?: Array<string>;
          clicked?: boolean;
          complained: boolean;
          createdAt: number;
          deliveryDelayed?: boolean;
          errorMessage?: string;
          failed?: boolean;
          finalizedAt: number;
          from: string;
          headers?: Array<{ name: string; value: string }>;
          html?: string;
          opened: boolean;
          replyTo: Array<string>;
          resendId?: string;
          segment: number;
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
          subject?: string;
          template?: {
            id: string;
            variables?: Record<string, string | number>;
          };
          text?: string;
          to: Array<string>;
        } | null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { emailId: string },
        {
          bounced: boolean;
          clicked: boolean;
          complained: boolean;
          deliveryDelayed: boolean;
          errorMessage: string | null;
          failed: boolean;
          opened: boolean;
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
        } | null
      >;
      handleEmailEvent: FunctionReference<
        "mutation",
        "internal",
        { event: any },
        null
      >;
      sendEmail: FunctionReference<
        "mutation",
        "internal",
        {
          bcc?: Array<string>;
          cc?: Array<string>;
          from: string;
          headers?: Array<{ name: string; value: string }>;
          html?: string;
          options: {
            apiKey: string;
            initialBackoffMs: number;
            onEmailEvent?: { fnHandle: string };
            retryAttempts: number;
            testMode: boolean;
          };
          replyTo?: Array<string>;
          subject?: string;
          template?: {
            id: string;
            variables?: Record<string, string | number>;
          };
          text?: string;
          to: Array<string>;
        },
        string
      >;
      updateManualEmail: FunctionReference<
        "mutation",
        "internal",
        {
          emailId: string;
          errorMessage?: string;
          resendId?: string;
          status:
            | "waiting"
            | "queued"
            | "cancelled"
            | "sent"
            | "delivered"
            | "delivery_delayed"
            | "bounced"
            | "failed";
        },
        null
      >;
    };
  };
};
