/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import type { AuthApiRefs } from "../client/index";
import { Auth as AuthFactory } from "./factory";
import { Fx } from "./fx";
import { AuthError } from "./fx";
import type { Doc } from "./types";
import type {
  AuthAuthorizationConfig,
  AuthGrant,
  AuthProviderConfig,
  AuthRoleDefinition,
  AuthRoleId,
  ConvexAuthConfig,
  HasDeviceProvider,
  HasPasskeyProvider,
  HasSSO,
  HasTotpProvider,
} from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Config for auth setup. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 */
export type AuthConfig = Omit<ConvexAuthConfig, "component">;

type MemberApiWithAuthorization<
  TAuthorization extends AuthAuthorizationConfig | undefined,
> = Omit<
  ReturnType<typeof AuthFactory>["auth"]["member"],
  "create" | "list" | "update" | "resolve"
> & {
  create: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["create"]
    >[0],
    data: {
      groupId: string;
      userId: string;
      roleIds?: AuthRoleId<TAuthorization>[];
      status?: string;
      extend?: Record<string, unknown>;
    },
  ) => Promise<{ ok: true; memberId: string }>;
  list: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["list"]
    >[0],
    opts?: {
      where?: {
        groupId?: string;
        userId?: string;
        roleId?: AuthRoleId<TAuthorization>;
        status?: string;
      };
      limit?: number;
      cursor?: string | null;
      orderBy?: "_creationTime" | "status";
      order?: "asc" | "desc";
    },
  ) => ReturnType<ReturnType<typeof AuthFactory>["auth"]["member"]["list"]>;
  update: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["update"]
    >[0],
    memberId: string,
    data: Record<string, unknown> & { roleIds?: AuthRoleId<TAuthorization>[] },
  ) => Promise<{ ok: true; memberId: string }>;
  resolve: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["resolve"]
    >[0],
    opts: {
      userId: string;
      groupId: string;
      roleIds?: AuthRoleId<TAuthorization>[];
      grants?: AuthGrant<TAuthorization>[];
      maxDepth?: number;
    },
  ) => ReturnType<ReturnType<typeof AuthFactory>["auth"]["member"]["resolve"]>;
};

type AccessApiWithAuthorization<
  TAuthorization extends AuthAuthorizationConfig | undefined,
> = {
  check: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["access"]["check"]
    >[0],
    opts: {
      userId: string;
      groupId: string;
      grants: AuthGrant<TAuthorization>[];
      maxDepth?: number;
    },
  ) => ReturnType<ReturnType<typeof AuthFactory>["auth"]["access"]["check"]>;
};

/** The base auth API surface, without conditional namespaces. */
export type AuthApiBase<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
> = {
  signIn: ReturnType<typeof AuthFactory>["signIn"];
  signOut: ReturnType<typeof AuthFactory>["signOut"];
  store: ReturnType<typeof AuthFactory>["store"];
  user: ReturnType<typeof AuthFactory>["auth"]["user"];
  session: ReturnType<typeof AuthFactory>["auth"]["session"];
  provider: ReturnType<typeof AuthFactory>["auth"]["provider"];
  account: ReturnType<typeof AuthFactory>["auth"]["account"];
  group: ReturnType<typeof AuthFactory>["auth"]["group"];
  member: MemberApiWithAuthorization<TAuthorization>;
  access: AccessApiWithAuthorization<TAuthorization>;
  invite: ReturnType<typeof AuthFactory>["auth"]["invite"];
  key: ReturnType<typeof AuthFactory>["auth"]["key"];
  http: ReturnType<typeof AuthFactory>["auth"]["http"];
};

type InternalSsoApi = ReturnType<typeof AuthFactory>["auth"]["sso"];

type PublicSsoAdminApi = {
  connection: InternalSsoApi["connection"] & {
    domain: {
      list: InternalSsoApi["domain"]["list"];
      validate: InternalSsoApi["domain"]["validate"];
      set: (
        ctx: Parameters<InternalSsoApi["connection"]["create"]>[0],
        enterpriseId: string,
        domains: Array<{
          domain: string;
          isPrimary?: boolean;
        }>,
      ) => Promise<{
        ok: true;
        enterpriseId: string;
        domains: Array<{
          domainId: string;
          domain: string;
          isPrimary: boolean;
          verified: boolean;
          verifiedAt: number | null;
        }>;
      }>;
      verification: {
        request: (
          ctx: Parameters<InternalSsoApi["connection"]["create"]>[0],
          args: { enterpriseId: string; domain: string },
        ) => Promise<{
          ok: true;
          enterpriseId: string;
          domain: string;
          requestedAt: number;
          expiresAt: number;
          challenge: {
            recordType: "TXT";
            recordName: string;
            recordValue: string;
          };
        }>;
        confirm: (
          ctx: Parameters<InternalSsoApi["connection"]["create"]>[0],
          args: { enterpriseId: string; domain: string },
        ) => Promise<{
          ok: boolean;
          enterpriseId: string;
          domain: string;
          verifiedAt?: number;
          checks: Array<{ name: string; ok: boolean; message?: string }>;
        }>;
      };
    };
  };
  oidc: Omit<InternalSsoApi["oidc"], "signIn">;
  saml: Omit<InternalSsoApi["saml"], "metadata">;
  policy: InternalSsoApi["policy"];
  audit: {
    list: InternalSsoApi["audit"]["list"];
  };
  webhook: {
    endpoint: InternalSsoApi["webhook"]["endpoint"];
    delivery: {
      list: InternalSsoApi["webhook"]["delivery"]["list"];
    };
  };
};

type PublicSsoClientApi = {
  signIn: InternalSsoApi["oidc"]["signIn"];
  metadata: InternalSsoApi["saml"]["metadata"];
};

type PublicSsoApi = {
  admin: PublicSsoAdminApi;
  client: PublicSsoClientApi;
};

type PublicScimApi = {
  admin: Omit<InternalSsoApi["scim"], "getConfigByToken" | "identity">;
};

/** Auth API with enterprise namespaces — present only when `new SSO()` is in providers. */
export type AuthApi<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
> = AuthApiBase<TAuthorization> & {
  sso: PublicSsoApi;
  scim: PublicScimApi;
};

/**
 * The return type of `createAuth`. Conditional namespaces:
 * - `auth.sso` and `auth.scim` — only when `new SSO()` is in providers
 * - `auth.clientApi` — typed API refs for the client SDK with capabilities
 */
export type ConvexAuthResult<
  P extends AuthProviderConfig[],
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
> =
  HasSSO<P> extends true
    ? AuthApi<TAuthorization>
    : AuthApiBase<TAuthorization>;

/**
 * Infer the typed `AuthApiRefs` for the client SDK from a `createAuth` call.
 *
 * Use this as the generic parameter for `client()` on the frontend:
 *
 * ```ts
 * // convex/auth.ts
 * export const auth = createAuth(components.auth, { providers: [...] });
 *
 * // Frontend
 * import type { auth } from "../convex/auth";
 * import type { InferClientApi } from "@robelest/convex-auth/component";
 * const c = client<InferClientApi<typeof auth>>({ convex, api: api.auth });
 * ```
 */
export type InferClientApi<T> =
  T extends ConvexAuthResult<infer P>
    ? AuthApiRefs<
        HasPasskeyProvider<P>,
        HasTotpProvider<P>,
        HasDeviceProvider<P>
      >
    : AuthApiRefs;

/** @internal */
export type AuthLike = Pick<AuthApiBase, "user">;

// ============================================================================
// Auth setup APIs
// ============================================================================

/**
 * Create an auth API object.
 *
 * When `new SSO()` is included in providers, `auth.sso` and `auth.scim`
 * are available on the returned object. Without it, those namespaces are
 * absent and accessing them is a TypeScript compile error.
 */
export function createAuth<
  P extends AuthProviderConfig[],
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
>(
  component: ConvexAuthConfig["component"],
  config: Omit<AuthConfig, "providers" | "authorization"> & {
    providers: P;
    authorization?: TAuthorization;
  },
): ConvexAuthResult<P, TAuthorization> {
  const authResult = AuthFactory({
    ...config,
    component,
    providers: [...config.providers],
  });
  const {
    domain: domainApi,
    scim: scimApi,
    connection: connectionApi,
    audit: auditApi,
    webhook: webhookApi,
    oidc: oidcApi,
    saml: samlApi,
    ...restSso
  } = authResult.auth.sso as InternalSsoApi;

  type SetEnterpriseDomains = PublicSsoAdminApi["connection"]["domain"]["set"];
  type EnterpriseDomainInput = Array<{
    domain: string;
    isPrimary?: boolean;
  }>;
  const setEnterpriseDomains: PublicSsoAdminApi["connection"]["domain"]["set"] =
    async (
      ctx: Parameters<SetEnterpriseDomains>[0],
      enterpriseId: Parameters<SetEnterpriseDomains>[1],
      domains: EnterpriseDomainInput,
    ) => {
      const enterprise = await connectionApi.get(ctx, enterpriseId);
      if (enterprise === null) {
        throw new AuthError(
          "INVALID_PARAMETERS",
          "Enterprise not found.",
        ).toConvexError();
      }

      const normalized = domains.map((entry: (typeof domains)[number]) => ({
        ...entry,
        domain: entry.domain.trim().toLowerCase(),
      }));
      const deduped = new Map<string, (typeof normalized)[number]>();
      for (const entry of normalized) {
        if (entry.domain.length === 0) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            "Domain must not be empty.",
          ).toConvexError();
        }
        if (deduped.has(entry.domain)) {
          throw new AuthError(
            "INVALID_PARAMETERS",
            `Duplicate domain: ${entry.domain}`,
          ).toConvexError();
        }
        deduped.set(entry.domain, entry);
      }

      const nextDomains = [...deduped.values()];
      const primaryCount = nextDomains.filter(
        (entry) => entry.isPrimary,
      ).length;
      if (primaryCount > 1) {
        throw new AuthError(
          "INVALID_PARAMETERS",
          "Only one primary domain may be set.",
        ).toConvexError();
      }
      if (nextDomains.length > 0 && primaryCount === 0) {
        nextDomains[0] = { ...nextDomains[0], isPrimary: true };
      }

      const currentDomains = await domainApi.list(ctx, enterpriseId);
      const currentByDomain = new Map<string, (typeof currentDomains)[number]>(
        currentDomains.map((entry: (typeof currentDomains)[number]) => [
          entry.domain.toLowerCase(),
          entry,
        ]),
      );

      for (const existing of currentDomains) {
        if (!deduped.has(existing.domain.toLowerCase())) {
          await domainApi.remove(ctx, existing._id);
        }
      }

      for (const nextDomain of nextDomains) {
        const current = currentByDomain.get(nextDomain.domain);
        if (current && current.isPrimary === Boolean(nextDomain.isPrimary)) {
          continue;
        }
        if (current) {
          await domainApi.remove(ctx, current._id);
        }
        const domainId = await domainApi.add(ctx, {
          enterpriseId: enterprise._id,
          groupId: enterprise.groupId,
          domain: nextDomain.domain,
          isPrimary: nextDomain.isPrimary,
        });
        if (current?.verifiedAt !== undefined) {
          await (ctx as any).runMutation(
            component.public.enterpriseDomainVerify,
            {
              domainId,
              verifiedAt: current.verifiedAt,
            },
          );
        }
      }

      const updatedDomains = await domainApi.list(ctx, enterpriseId);
      return {
        ok: true as const,
        enterpriseId,
        domains: updatedDomains.map(
          (domain: (typeof updatedDomains)[number]) => ({
            domainId: domain._id,
            domain: domain.domain,
            isPrimary: domain.isPrimary,
            verified: domain.verifiedAt !== undefined,
            verifiedAt: domain.verifiedAt ?? null,
          }),
        ),
      };
    };

  const publicSso: PublicSsoApi = {
    admin: {
      ...restSso,
      oidc: {
        ...oidcApi,
      },
      saml: {
        ...samlApi,
      },
      connection: {
        ...connectionApi,
        domain: {
          list: domainApi.list,
          validate: domainApi.validate,
          set: setEnterpriseDomains,
          verification: {
            request: domainApi.verification.request,
            confirm: domainApi.verification.confirm,
          },
        },
      },
      policy: restSso.policy,
      audit: {
        list: auditApi.list,
      },
      webhook: {
        endpoint: webhookApi.endpoint,
        delivery: {
          list: webhookApi.delivery.list,
        },
      },
    },
    client: {
      signIn: oidcApi.signIn,
      metadata: samlApi.metadata,
    },
  };

  return {
    signIn: authResult.signIn,
    signOut: authResult.signOut,
    store: authResult.store,
    user: authResult.auth.user,
    session: authResult.auth.session,
    provider: authResult.auth.provider,
    account: authResult.auth.account,
    group: authResult.auth.group,
    member: authResult.auth.member,
    access: authResult.auth.access,
    invite: authResult.auth.invite,
    key: authResult.auth.key,
    sso: publicSso,
    scim: {
      admin: {
        configure: scimApi.configure,
        get: scimApi.get,
        validate: scimApi.validate,
      },
    },
    http: authResult.auth.http,
  } as unknown as ConvexAuthResult<P, TAuthorization>;
}

// ============================================================================
// AuthCtx — ctx enrichment for customQuery / customMutation
// ============================================================================

export type UserDoc = Doc<"User">;

export type AuthCtxConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
> = {
  optional?: boolean;
  resolve?: (ctx: any, user: UserDoc) => Promise<TResolve> | TResolve;
};

/** Overload: optional auth */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  config: AuthCtxConfig<TResolve> & { optional: true },
): {
  args: {};
  input: (
    ctx: any,
    _args: any,
    _extra?: any,
  ) => Promise<{
    ctx: {
      auth: {
        getUserIdentity: () => Promise<UserIdentity | null>;
        userId: GenericId<"User"> | null;
        user: UserDoc | null;
      } & TResolve;
    };
    args: {};
  }>;
};
/** Overload: required auth (default) */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  config?: AuthCtxConfig<TResolve>,
): {
  args: {};
  input: (
    ctx: any,
    _args: any,
    _extra?: any,
  ) => Promise<{
    ctx: {
      auth: {
        getUserIdentity: () => Promise<UserIdentity | null>;
        userId: GenericId<"User">;
        user: UserDoc;
      } & TResolve;
    };
    args: {};
  }>;
};
// Implementation
export function AuthCtx(auth: AuthLike, config?: AuthCtxConfig<any>) {
  return {
    args: {},
    input: async (ctx: any, _args: any, _extra?: any) => {
      const nativeAuth = ctx.auth;
      const modeDispatch =
        config?.optional === true
          ? { mode: "optional" as const }
          : { mode: "required" as const };

      const userContext = await Fx.run(
        Fx.match(modeDispatch, modeDispatch.mode, {
          optional: async () => {
            const userId = await auth.user.id(ctx);
            if (!userId) {
              return null;
            }
            const user = await auth.user.get(ctx, userId);
            return { userId, user };
          },
          required: async () => {
            const userId = await auth.user.id(ctx);
            if (!userId) {
              return null;
            }
            const user = await auth.user.get(ctx, userId);
            return { userId, user };
          },
        }),
      );

      if (userContext === null) {
        return {
          ctx: {
            auth: {
              getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
              userId: null,
              user: null,
            },
          },
          args: {},
        };
      }

      const extra = config?.resolve
        ? await config.resolve(ctx, userContext.user)
        : {};

      return {
        ctx: {
          auth: {
            getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
            userId: userContext.userId,
            user: userContext.user,
            ...extra,
          },
        },
        args: {},
      };
    },
  };
}

export type InferAuth<
  T extends { input: (...args: any[]) => Promise<{ ctx: { auth: any } }> },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];
