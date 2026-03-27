/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import { Cv } from "@robelest/fx/convex";
import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import type { AuthApiRefs } from "../client/index";
import { Auth as AuthFactory } from "./runtime";
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

/** Canonical user document type exposed by Convex Auth. */
export type UserDoc = Doc<"User">;

type MemberApiWithAuthorization<
  TAuthorization extends AuthAuthorizationConfig | undefined,
> = Omit<
  ReturnType<typeof AuthFactory>["auth"]["member"],
  "create" | "list" | "update" | "inspect" | "require"
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
  ) => Promise<{ memberId: string }>;
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
  ) => Promise<{ memberId: string }>;
  inspect: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["inspect"]
    >[0],
    opts: {
      userId: string;
      groupId: string;
      ancestry?: boolean;
      maxDepth?: number;
    },
  ) => ReturnType<ReturnType<typeof AuthFactory>["auth"]["member"]["inspect"]>;
  require: (
    ctx: Parameters<
      ReturnType<typeof AuthFactory>["auth"]["member"]["require"]
    >[0],
    opts: {
      userId: string;
      groupId: string;
      ancestry?: boolean;
      roleIds?: AuthRoleId<TAuthorization>[];
      grants?: AuthGrant<TAuthorization>[];
      maxDepth?: number;
    },
  ) => ReturnType<ReturnType<typeof AuthFactory>["auth"]["member"]["require"]>;
};

/**
 * The base auth API surface returned by {@link createAuth}.
 *
 * Provides core namespaces — `signIn`, `signOut`, `user`, `session`,
 * `member`, `invite`, `group`, `key`, and `http` — that are
 * always available regardless of which providers are configured.
 * Enterprise namespaces (`sso`, `scim`) are added conditionally by
 * {@link AuthApi} when an SSO provider is present.
 *
 * Use this type when you want to describe code that only depends on the
 * standard auth surface and should not assume enterprise features exist.
 *
 * @typeParam TAuthorization - The authorization config, used to narrow
 *   role IDs and grant strings on the `member` API.
 */
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
  invite: ReturnType<typeof AuthFactory>["auth"]["invite"];
  key: ReturnType<typeof AuthFactory>["auth"]["key"];
  http: ReturnType<typeof AuthFactory>["auth"]["http"];
  /**
   * Resolve the current request's auth context. Framework-agnostic — use
   * this in fluent-convex middleware, custom wrappers, or anywhere you
   * need the current `{ userId, user, groupId, role, grants }` object.
   *
   * Throws a structured `ConvexError` when unauthenticated.
   *
   * @param ctx - Convex query, mutation, or action context.
   * @returns The current auth context.
   *
   * @example fluent-convex middleware
   * ```ts
   * const withAuth = convex.createMiddleware(async (ctx, next) => {
   *   return next({ ...ctx, auth: await auth.context(ctx) });
   * });
   * ```
   *
   * @example Direct usage in a handler
   * ```ts
   * const authContext = await auth.context(ctx);
   * const { userId, grants } = authContext;
   * ```
   */
  context: (ctx: any) => Promise<AuthContext>;
  /**
   * Context enrichment for convex-helpers `customQuery` / `customMutation` /
   * `customAction`.
   *
   * Resolves the current user's identity, active group, membership role,
   * and grants, then attaches them to `ctx.auth`. Returns a `Customization`
   * object compatible with convex-helpers' custom function builders.
   *
   * `ctx.auth` is the current request auth context.
   * By default this throws when unauthenticated so handlers can assume
   * `ctx.auth.userId` and `ctx.auth.user` exist.
   *
   * @returns A convex-helpers `Customization` object.
   *
   * @example One-time setup in `convex/functions.ts`
   * ```ts
   * import { query, mutation, action } from "./_generated/server";
   * import { customQuery, customMutation, customAction } from "convex-helpers/server/customFunctions";
   * import { auth } from "./auth";
   *
   * export const authQuery = customQuery(query, auth.ctx());
   * export const authMutation = customMutation(mutation, auth.ctx());
   * export const authAction = customAction(action, auth.ctx());
   * ```
   *
   * @example Per-function usage
   * ```ts
   * import { authQuery } from "./functions";
   *
   * export const list = authQuery({
   *   args: { workspaceId: v.string() },
   *   handler: async (ctx, args) => {
   *     const { userId, groupId, grants } = ctx.auth;
   *     // business logic
   *   },
   * });
   * ```
   */
  ctx: () => {
    args: Record<string, never>;
    input: (ctx: any) => Promise<{
      ctx: { auth: AuthContext };
      args: Record<string, never>;
    }>;
  };
};

/**
 * Current request auth context injected into `ctx.auth` by `auth.ctx()` and
 * {@link AuthCtx}. This is the authenticated auth shape returned by
 * {@link createAuth().context}. Optional context builders may still surface
 * nullable fields when `optional: true` is used.
 *
 * - `groupId` is `null` when the user has no active group set.
 * - `role` is `null` when no active group or no membership is resolved.
 * - `grants` is `[]` when no active group or no membership is resolved.
 *
 * @example
 * ```ts
 * import type { AuthContext } from "@robelest/convex-auth/server";
 *
 * const mockAuth: AuthContext = {
 *   userId: "user123" as Id<"User">,
 *   user: { _id: "user123", email: "test@example.com" },
 *   groupId: "group456",
 *   role: "admin",
 *   grants: ["read", "write"],
 * };
 * ```
 */
export type AuthContext = {
  /** The authenticated user's document ID. */
  userId: GenericId<"User">;
  /** The authenticated user's full document. */
  user: UserDoc;
  /** The user's active group ID, or `null` if none set. */
  groupId: string | null;
  /** The user's primary role in the active group, or `null`. */
  role: string | null;
  /** Resolved grant strings from the user's role definitions. */
  grants: string[];
};

type AuthCtxBase = {
  getUserIdentity: () => Promise<UserIdentity | null>;
};

type RequiredAuthCtxState = AuthCtxBase & AuthContext;

type OptionalAuthCtxState = AuthCtxBase & {
  userId: GenericId<"User"> | null;
  user: UserDoc | null;
  groupId: string | null;
  role: string | null;
  grants: string[];
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

/**
 * Extended auth API that includes enterprise SSO and SCIM namespaces.
 *
 * This type is the union of {@link AuthApiBase} plus `sso` (SSO connection
 * management, OIDC/SAML, domain verification, policies, audit, webhooks)
 * and `scim` (SCIM provisioning configuration). It is returned by
 * {@link createAuth} only when `new SSO()` is included in the providers
 * array; otherwise the narrower {@link AuthApiBase} is returned instead.
 * Attempting to access `auth.sso` or `auth.scim` without an SSO provider
 * produces a compile-time error because the return type narrows back to
 * {@link AuthApiBase}.
 *
 * @typeParam TAuthorization - The authorization config, forwarded to
 *   {@link AuthApiBase} for typed role IDs and grant strings.
 */
export type AuthApi<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
> = AuthApiBase<TAuthorization> & {
  sso: PublicSsoApi;
  scim: PublicScimApi;
};

/**
 * The return type of {@link createAuth}.
 *
 * Resolves to {@link AuthApi} (with `sso` and `scim` namespaces) when
 * `new SSO()` is present in the providers array, or to the narrower
 * {@link AuthApiBase} otherwise. This conditional type ensures that
 * enterprise-only APIs are only accessible when the SSO provider is
 * configured, producing a compile-time error if you try to access
 * `auth.sso` without it.
 * This lets application code keep a single `createAuth()` call while still
 * getting provider-aware typing on the resulting API object.
 *
 * @typeParam P - The tuple of provider configs passed to `createAuth`.
 * @typeParam TAuthorization - Optional authorization config for typed roles/grants.
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
 * import type { InferClientApi } from "@robelest/convex-auth/server";
 * const c = client<InferClientApi<typeof auth>>({ convex, api: api.auth });
 * ```
 *
 * @typeParam T - A ConvexAuthResult to extract the client API from.
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
export type AuthLike = Pick<AuthApiBase, "user" | "member">;

// ============================================================================
// Auth setup APIs
// ============================================================================

/**
 * Create an auth API object.
 *
 * When `new SSO()` is included in providers, `auth.sso` and `auth.scim`
 * are available on the returned object. Without it, those namespaces are
 * absent and accessing them is a TypeScript compile error.
 *
 * @param component - The installed auth component reference from
 *   `components.auth` in your Convex app definition.
 * @param config - Auth configuration including `providers` and optional
 *   `authorization`. All fields from {@link AuthConfig} are accepted
 *   except `component` (passed as the first argument).
 * @returns A {@link ConvexAuthResult} object — either {@link AuthApi}
 *   (with `sso`/`scim`) or {@link AuthApiBase}, depending on whether
 *   an SSO provider is present.
 *
 * @example
 * ```ts
 * export const auth = createAuth(components.auth, {
 *   providers: [password(), google()],
 *   authorization: { roles },
 * });
 * ```
 *
 * @see {@link AuthCtx}
 */

// ---------------------------------------------------------------------------
// Function builders — shared auth resolution logic
// ---------------------------------------------------------------------------

/**
 * Resolve auth context for the current user. Returns the enriched
 * `ctx.auth` object or `null` when unauthenticated.
 *
 * Resolution flow:
 * 1. `user.id(ctx)` → userId or null (exit early)
 * 2. `user.get(ctx, userId)` → user doc (cached per-execution)
 * 3. `user.getActiveGroup(ctx, { userId })` → groupId or null
 * 4. If groupId → `member.inspect(ctx, { userId, groupId })` → role + grants
 */
async function getAuthContext(
  auth: AuthLike,
  ctx: any,
): Promise<AuthContext | null> {
  const userId = await auth.user.id(ctx);
  if (!userId) return null;
  const user = await auth.user.get(ctx, userId);
  const groupId = await auth.user.getActiveGroup(ctx, { userId });
  let role: string | null = null;
  let grants: string[] = [];
  if (groupId) {
    const resolved = await auth.member.inspect(ctx, { userId, groupId });
    if (resolved.membership) {
      role = resolved.roleIds[0] ?? null;
      grants = resolved.grants;
    }
  }
  return { userId, user, groupId, role, grants };
}

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
        throw Cv.error({
          code: "INVALID_PARAMETERS",
          message: "Enterprise not found.",
        });
      }

      const normalized = domains.map((entry: (typeof domains)[number]) => ({
        ...entry,
        domain: entry.domain.trim().toLowerCase(),
      }));
      const deduped = new Map<string, (typeof normalized)[number]>();
      for (const entry of normalized) {
        if (entry.domain.length === 0) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: "Domain must not be empty.",
          });
        }
        if (deduped.has(entry.domain)) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: `Duplicate domain: ${entry.domain}`,
          });
        }
        deduped.set(entry.domain, entry);
      }

      const nextDomains = [...deduped.values()];
      const primaryCount = nextDomains.filter(
        (entry) => entry.isPrimary,
      ).length;
      if (primaryCount > 1) {
        throw Cv.error({
          code: "INVALID_PARAMETERS",
          message: "Only one primary domain may be set.",
        });
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

    context: async (ctx: any) => {
      const authContext = await getAuthContext(authResult.auth, ctx);
      if (authContext === null) {
        throw Cv.error({
          code: "NOT_SIGNED_IN",
          message: "Authentication required.",
        });
      }
      return authContext;
    },

    ctx: () => ({
      args: {},
      input: async (ctx: any) => {
        const authCtx = await getAuthContext(authResult.auth, ctx);
        if (authCtx === null) {
          throw Cv.error({
            code: "NOT_SIGNED_IN",
            message: "Authentication required.",
          });
        }
        return { ctx: { auth: authCtx }, args: {} };
      },
    }),
  } as unknown as ConvexAuthResult<P, TAuthorization>;
}

// ============================================================================
// AuthCtx — ctx enrichment for customQuery / customMutation
// ============================================================================

/**
 * Configuration for {@link AuthCtx} context enrichment.
 *
 * @typeParam TResolve - Extra fields returned from `resolve()` and merged into
 *   the resulting `ctx.auth` object.
 */
export type AuthCtxConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
> = {
  /** Allow unauthenticated callers and return `userId: null` / `user: null`. */
  optional?: boolean;
  /**
   * Attach additional derived fields to the auth context after the base auth
   * context is resolved.
   */
  resolve?: (
    ctx: any,
    user: UserDoc,
    auth: AuthContext,
  ) => Promise<TResolve> | TResolve;
  /**
   * Override or wrap the base auth resolution used by {@link AuthCtx}.
   *
   * Return `undefined` to fall back to the built-in resolver,
   * `null` for an explicit unauthenticated state, or an
   * {@link AuthContext} object to provide a pre-resolved auth state.
   * This is useful for tests, proxy auth, impersonation flows, or any
   * environment that needs to inject auth without depending on the standard
   * Convex auth tables.
   *
   * @param ctx - The Convex function context.
   * @param fallback - The built-in auth resolver used by {@link AuthCtx}.
   * @returns Resolved auth state, `null`, or `undefined` to use the fallback.
   *
   * @example
   * ```ts
   * const authCtx = AuthCtx(auth, {
   *   authResolve: async (ctx, fallback) => {
   *     const injected = getInjectedAuth(ctx);
   *     return injected ?? (await fallback());
   *   },
   * });
   * ```
   */
  authResolve?: (
    ctx: any,
    fallback: () => Promise<AuthContext | null>,
  ) => Promise<AuthContext | null | undefined> | AuthContext | null | undefined;
};

/**
 * Create a context enrichment for `customQuery` / `customMutation` — optional auth.
 *
 * When `optional: true` is set, unauthenticated requests are allowed.
 * The enriched `ctx.auth` will have `userId: null`, `user: null`,
 * `groupId: null`, `role: null`, and `grants: []` for unauthenticated callers.
 *
 * @param auth - The auth API object returned by {@link createAuth}.
 * @param config - Configuration with `optional: true` and an optional
 *   `resolve` callback for attaching extra fields to the auth context.
 * @returns An object with `args` and `input` compatible with Convex
 *   custom function builders.
 *
 * @example
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   optional: true,
 *   resolve: async (_ctx, user) => ({ plan: user?.extend?.plan ?? null }),
 * });
 * ```
 *
 * @see {@link createAuth}
 */
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
      auth: OptionalAuthCtxState & TResolve;
    };
    args: {};
  }>;
};
/**
 * Create a context enrichment for `customQuery` / `customMutation` — required auth (default).
 *
 * When `optional` is omitted or `false`, unauthenticated requests throw a
 * structured `ConvexError` before your handler runs.
 *
 * @param auth - The auth API object returned by {@link createAuth}.
 * @param config - Optional configuration with a `resolve` callback
 *   for attaching extra fields to the auth context.
 * @returns An object with `args` and `input` compatible with Convex
 *   custom function builders.
 *
 * @example
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (_ctx, user) => ({ email: user.email }),
 * });
 * ```
 *
 * @see {@link createAuth}
 */
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
      auth: RequiredAuthCtxState & TResolve;
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
      const getUserIdentity = nativeAuth.getUserIdentity.bind(nativeAuth);
      const fallback = () => getAuthContext(auth, ctx);

      const authOverride = config?.authResolve
        ? await config.authResolve(ctx, fallback)
        : undefined;
      const resolved =
        authOverride === undefined ? await fallback() : authOverride;

      if (resolved === null) {
        if (config?.optional !== true) {
          throw Cv.error({
            code: "NOT_SIGNED_IN",
            message: "Authentication required.",
          });
        }
        return {
          ctx: {
            auth: {
              getUserIdentity,
              userId: null,
              user: null,
              groupId: null,
              role: null,
              grants: [],
            },
          },
          args: {},
        };
      }

      const extra = config?.resolve
        ? await config.resolve(ctx, resolved.user, resolved)
        : {};

      return {
        ctx: {
          auth: {
            getUserIdentity,
            ...resolved,
            ...extra,
          },
        },
        args: {},
      };
    },
  };
}

/**
 * Extract the resolved `auth` context type from an {@link AuthCtx} instance.
 *
 * Use this to type function parameters or variables that receive the
 * enriched auth context produced by `AuthCtx`. The inferred type includes
 * `userId`, `user`, `groupId`, `role`, `grants`, `getUserIdentity`, and any
 * additional fields added by the `resolve` callback. This is the generic
 * utility for reusing the enriched auth shape without manually duplicating
 * conditional auth types.
 *
 * @typeParam T - An `AuthCtx` return value (must have an `input` method
 *   that returns `{ ctx: { auth: ... } }`).
 *
 * @example
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (ctx, user) => ({ orgId: user.orgId }),
 * });
 * type Auth = InferAuth<typeof authCtx>;
 * // Auth = { userId: Id<"User">; user: UserDoc; getUserIdentity: ...; orgId: string }
 * ```
 *
 * @see {@link createAuth}
 */
export type InferAuth<
  T extends { input: (...args: any[]) => Promise<{ ctx: { auth: any } }> },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];
