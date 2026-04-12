/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import type { GenericActionCtx, GenericDataModel, UserIdentity } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import type { AuthApiRefs } from "../client/index";
import {
  createUnauthenticatedAuthContext,
  getAuthContext as getResolvedAuthContext,
} from "./context";
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

type AuthIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};

type AuthQueryCtx = {
  runQuery: (...args: never[]) => Promise<unknown>;
};

type CustomFunctionInputResult<TAuth extends Record<string, unknown>> = Promise<{
  ctx: { auth: TAuth };
}>;

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
 * Group SSO helpers under `group.sso` are added conditionally by
 * {@link AuthApi} when an SSO provider is present.
 *
 * Use this type when you want to describe code that only depends on the
 * standard auth surface and should not assume group connection features exist.
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
   * Throws a structured `ConvexError` when unauthenticated by default.
   * Pass `{ optional: true }` to get a null-shaped auth object instead.
   *
   * @param ctx - Convex query, mutation, or action context.
   * @param config - Optional auth resolution config. Supports `optional`,
   *   `resolve`, and `authResolve`.
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
   *
   * @example Optional usage
   * ```ts
   * const authContext = await auth.context(ctx, { optional: true });
   * if (authContext.userId === null) {
   *   return null;
   * }
   * ```
   */
  context: AuthContextResolver;
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
  ctx: AuthContextFactory;
};

/**
 * Current request auth context injected into `ctx.auth` by `auth.ctx()`. This
 * is the authenticated auth shape returned by {@link createAuth().context}.
 * Optional context builders may still surface nullable fields when
 * `optional: true` is used.
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

/**
 * Nullable auth context returned by `auth.context(ctx, { optional: true })`
 * and injected by `auth.ctx({ optional: true })`.
 *
 * Use this when callers may be unauthenticated but you still want a stable
 * auth-shaped object.
 *
 * - `userId` and `user` are `null` when unauthenticated.
 * - `groupId` and `role` are `null` when no active group is resolved.
 * - `grants` is `[]` when no membership is resolved.
 *
 * @example
 * ```ts
 * const authContext = await auth.context(ctx, { optional: true });
 * if (authContext.userId === null) {
 *   return null;
 * }
 * ```
 */
export type OptionalAuthContext = {
  /** The authenticated user's document ID, or `null` when unauthenticated. */
  userId: GenericId<"User"> | null;
  /** The authenticated user's full document, or `null` when unauthenticated. */
  user: UserDoc | null;
  /** The user's active group ID, or `null` if none is set. */
  groupId: string | null;
  /** The user's primary role in the active group, or `null`. */
  role: string | null;
  /** Resolved grant strings for the active membership, or `[]`. */
  grants: string[];
};

type AuthContextBase = {
  getUserIdentity: () => Promise<UserIdentity | null>;
};

type RequiredAuthContextState = AuthContextBase & AuthContext;

type OptionalAuthContextState = AuthContextBase & OptionalAuthContext;

type ResolvedAuthContext<TResolve> = AuthContext & TResolve;

type ResolvedOptionalAuthContext<TResolve> = OptionalAuthContext & TResolve;

type AuthResolverCtx = AuthIdentityCtx & AuthQueryCtx;

type AuthContextResolver = {
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: AuthResolverCtx,
    config: AuthContextConfig<TResolve> & { optional: true },
  ): Promise<ResolvedOptionalAuthContext<TResolve>>;
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: AuthResolverCtx,
    config?: AuthContextConfig<TResolve>,
  ): Promise<ResolvedAuthContext<TResolve>>;
};

type AuthContextCustomization<TAuth> = {
  args: {};
  input: (
    ctx: AuthResolverCtx,
    _args: Record<string, never>,
    _extra?: unknown,
  ) => Promise<{
    ctx: {
      auth: TAuth;
    };
    args: {};
  }>;
};

type AuthContextFactory = {
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    config: AuthContextConfig<TResolve> & { optional: true },
  ): AuthContextCustomization<OptionalAuthContextState & TResolve>;
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    config?: AuthContextConfig<TResolve>,
  ): AuthContextCustomization<RequiredAuthContextState & TResolve>;
};

type InternalSsoApi = ReturnType<typeof AuthFactory>["auth"]["sso"];

type PublicGroupSsoApi = {
  signIn: (
    ctx: Parameters<InternalSsoApi["connection"]["create"]>[0],
    data: {
      connectionId?: string;
      email?: string;
      domain?: string;
      redirectTo?: string;
      loginHint?: string;
    },
  ) => Promise<{
    connectionId: string;
    protocol: "oidc" | "saml";
    providerId: string;
    signInPath: string;
    callbackPath: string;
    redirectTo?: string;
  }>;
  metadata: InternalSsoApi["saml"]["metadata"];
  connection: InternalSsoApi["connection"] & {
    domain: {
      list: InternalSsoApi["domain"]["list"];
      validate: InternalSsoApi["domain"]["validate"];
      status: InternalSsoApi["domain"]["status"];
      set: (
        ctx: Parameters<InternalSsoApi["connection"]["create"]>[0],
        connectionId: string,
        domains: Array<{
          domain: string;
          isPrimary?: boolean;
        }>,
      ) => Promise<{
        connectionId: string;
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
          args: { connectionId: string; domain: string },
        ) => Promise<{
          connectionId: string;
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
          args: { connectionId: string; domain: string },
        ) => Promise<{
          connectionId: string;
          domain: string;
          verifiedAt?: number;
          checks: Array<{ name: string; ok: boolean; message?: string }>;
        }>;
      };
    };
  };
  oidc: Omit<InternalSsoApi["oidc"], "signIn">;
  saml: InternalSsoApi["saml"];
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
  scim: Omit<InternalSsoApi["scim"], "getConfigByToken" | "identity">;
};

/**
 * Extended auth API that includes group SSO and SCIM namespaces.
 *
 * This type is the union of {@link AuthApiBase} plus `group.sso`
 * (SSO connection management, OIDC/SAML, SCIM, domain verification,
 * policies, audit, and webhooks). It is returned by
 * {@link createAuth} only when `sso()` is included in the providers
 * array; otherwise the narrower {@link AuthApiBase} is returned instead.
 * Attempting to access `auth.group.sso` without an SSO provider
 * produces a compile-time error because the return type narrows back to
 * {@link AuthApiBase}.
 *
 * @typeParam TAuthorization - The authorization config, forwarded to
 *   {@link AuthApiBase} for typed role IDs and grant strings.
 */
export type AuthApi<
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
> = AuthApiBase<TAuthorization> & {
  group: AuthApiBase<TAuthorization>["group"] & {
    sso: PublicGroupSsoApi;
  };
};

type PublicContextFactory = <TResolve extends Record<string, unknown> = Record<string, never>>(
  ctx: AuthResolverCtx,
  config?: AuthContextConfig<TResolve, AuthResolverCtx>,
) => Promise<ResolvedAuthContext<TResolve>>;

type PublicContextCustomizationFactory = <
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  config?: AuthContextConfig<TResolve, AuthResolverCtx>,
) => AuthContextCustomization<ResolvedAuthContext<TResolve>>;

/**
 * The return type of {@link createAuth}.
 *
 * Resolves to {@link AuthApi} (with `group.sso` helpers) when
 * `sso()` is present in the providers array, or to the narrower
 * {@link AuthApiBase} otherwise. This conditional type ensures that
 * group connection-only APIs are only accessible when the SSO provider is
 * configured, producing a compile-time error if you try to access
 * `auth.group.sso` without it.
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
 * When `sso()` is included in providers, `auth.group.sso` is available
 * on the returned object. Without it, that namespace is absent and
 * accessing it is a TypeScript compile error.
 *
 * @param component - The installed auth component reference from
 *   `components.auth` in your Convex app definition.
 * @param config - Auth configuration including `providers` and optional
 *   `authorization`. All fields from {@link AuthConfig} are accepted
 *   except `component` (passed as the first argument).
 * @returns A {@link ConvexAuthResult} object — either {@link AuthApi}
 *   (with `group.sso`) or {@link AuthApiBase}, depending on whether
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
 * @see {@link AuthContextConfig}
 */

// ---------------------------------------------------------------------------
// Function builders — shared auth resolution logic
// ---------------------------------------------------------------------------

async function resolveConfiguredAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  config?: AuthContextConfig<TResolve, TCtx>,
): Promise<AuthContext | null> {
  const fallback = () =>
    getResolvedAuthContext(
      auth,
      ctx as unknown as Parameters<typeof getResolvedAuthContext>[1],
    );
  const authOverride = config?.authResolve
    ? await config.authResolve(ctx, fallback)
    : undefined;
  return authOverride === undefined ? await fallback() : authOverride;
}

function createNotSignedInError() {
  return new ConvexError({
    code: "NOT_SIGNED_IN",
    message: "Authentication required.",
  });
}

async function createPublicAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  config?: AuthContextConfig<TResolve, TCtx>,
) {
  const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

  if (resolved === null) {
    if (config?.optional !== true) {
      throw createNotSignedInError();
    }
    return createUnauthenticatedAuthContext();
  }

  const extra = config?.resolve
    ? await config.resolve(ctx, resolved.user, resolved)
    : {};

  return {
    ...resolved,
    ...extra,
  };
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

  type SetGroupConnectionDomains =
    PublicGroupSsoApi["connection"]["domain"]["set"];
  type GroupConnectionDomainInput = Array<{
    domain: string;
    isPrimary?: boolean;
  }>;
  const setGroupConnectionDomains: PublicGroupSsoApi["connection"]["domain"]["set"] =
    async (
      ctx: Parameters<SetGroupConnectionDomains>[0],
      connectionId: Parameters<SetGroupConnectionDomains>[1],
      domains: GroupConnectionDomainInput,
    ) => {
      const connection = await connectionApi.get(ctx, connectionId);
      if (connection === null) {
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "Connection not found.",
        });
      }

      const normalized = domains.map((entry: (typeof domains)[number]) => ({
        ...entry,
        domain: entry.domain.trim().toLowerCase(),
      }));
      const deduped = new Map<string, (typeof normalized)[number]>();
      for (const entry of normalized) {
        if (entry.domain.length === 0) {
          throw new ConvexError({
            code: "INVALID_PARAMETERS",
            message: "Domain must not be empty.",
          });
        }
        if (deduped.has(entry.domain)) {
          throw new ConvexError({
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
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "Only one primary domain may be set.",
        });
      }
      if (nextDomains.length > 0 && primaryCount === 0) {
        nextDomains[0] = { ...nextDomains[0], isPrimary: true };
      }

      const currentDomains = await domainApi.list(ctx, connectionId);
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
          connectionId: connection._id,
          groupId: connection.groupId,
          domain: nextDomain.domain,
          isPrimary: Boolean(nextDomain.isPrimary),
        });
        if (current?.verifiedAt !== undefined) {
          await (ctx as {
            runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
          }).runMutation(
            component.public.groupConnectionDomainVerify,
            {
              domainId,
              verifiedAt: current.verifiedAt,
            },
          );
        }
      }

      const updatedDomains = await domainApi.list(ctx, connectionId);
      return {
        connectionId,
        domains: updatedDomains.map(
          (domain: (typeof updatedDomains)[number]) => ({
              domainId: domain._id,
              domain: domain.domain,
              isPrimary: Boolean(domain.isPrimary),
              verified: domain.verifiedAt !== undefined,
            verifiedAt: domain.verifiedAt ?? null,
          }),
        ),
      };
    };

  const publicGroupSso: PublicGroupSsoApi = {
    ...restSso,
    signIn: oidcApi.signIn,
    metadata: samlApi.metadata,
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
        status: domainApi.status,
        set: setGroupConnectionDomains,
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
    scim: {
      configure: scimApi.configure,
      get: scimApi.get,
      status: scimApi.status,
      validate: scimApi.validate,
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
    group: {
      ...authResult.auth.group,
      sso: publicGroupSso,
    },
    member: authResult.auth.member,
    invite: authResult.auth.invite,
    key: authResult.auth.key,
    http: authResult.auth.http,

    context: ((ctx: AuthResolverCtx, config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>) =>
      createPublicAuthContext(
        authResult.auth,
        ctx as Parameters<typeof createPublicAuthContext>[1],
        config,
      )) as PublicContextFactory as AuthContextResolver,

    ctx: ((config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>) =>
      createAuthContextCustomization(
        authResult.auth,
        config,
      )) as PublicContextCustomizationFactory as AuthContextFactory,
  } as unknown as ConvexAuthResult<P, TAuthorization>;
}

// ============================================================================
// auth.ctx() — ctx enrichment for customQuery / customMutation
// ============================================================================

/**
 * Configuration for {@link createAuth().ctx} context enrichment.
 *
 * The same config shape is also used by {@link createAuth().context}.
 *
 * @typeParam TResolve - Extra fields returned from `resolve()` and merged into
 *   the resulting `ctx.auth` object.
 *
 * @example
 * ```ts
 * const authContext = await auth.context(ctx, {
 *   resolve: async (_ctx, user, authState) => ({
 *     email: user.email,
 *     canWrite: authState.grants.includes("posts.write"),
 *   }),
 * });
 * ```
 */
export type AuthContextConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
  TCtx extends AuthIdentityCtx = AuthIdentityCtx,
> = {
  /**
   * Allow unauthenticated callers and return a null-shaped auth object instead
   * of throwing `NOT_SIGNED_IN`.
   */
  optional?: boolean;
  /**
   * Attach additional derived fields to the auth context after the base auth
   * context is resolved.
   *
   * This callback runs only when a user is authenticated.
   */
  resolve?: (
    ctx: TCtx,
    user: UserDoc,
    auth: AuthContext,
  ) => Promise<TResolve> | TResolve;
  /**
   * Override or wrap the base auth resolution used by {@link createAuth().ctx}.
   *
   * Return `undefined` to fall back to the built-in resolver,
   * `null` for an explicit unauthenticated state, or an
   * {@link AuthContext} object to provide a pre-resolved auth state.
   * This is useful for tests, proxy auth, impersonation flows, or any
   * environment that needs to inject auth without depending on the standard
   * Convex auth tables.
   *
   * @param ctx - The Convex function context.
   * @param fallback - The built-in auth resolver used by {@link createAuth().ctx}.
   * @returns Resolved auth state, `null`, or `undefined` to use the fallback.
   *
   * @example
   * ```ts
   * const authCtx = auth.ctx({
   *   authResolve: async (ctx, fallback) => {
   *     const injected = getInjectedAuth(ctx);
   *     return injected ?? (await fallback());
   *   },
   * });
   * ```
   */
  authResolve?: (
    ctx: TCtx,
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
 * @param config - Configuration with `optional: true` and an optional
 *   `resolve` callback for attaching extra fields to the auth context.
 * @returns An object with `args` and `input` compatible with Convex
 *   custom function builders.
 *
 * @example
 * ```ts
 * const authCtx = auth.ctx({
 *   optional: true,
 *   resolve: async (_ctx, user) => ({ plan: user.extend?.plan ?? null }),
 * });
 * ```
 *
 * @see {@link createAuth}
 */

/**
 * Create a context enrichment for `customQuery` / `customMutation` — required auth (default).
 *
 * When `optional` is omitted or `false`, unauthenticated requests throw a
 * structured `ConvexError` before your handler runs.
 *
 * @param config - Optional configuration with a `resolve` callback
 *   for attaching extra fields to the auth context.
 * @returns An object with `args` and `input` compatible with Convex
 *   custom function builders.
 *
 * @example
 * ```ts
 * const authCtx = auth.ctx({
 *   resolve: async (_ctx, user) => ({ email: user.email }),
 * });
 * ```
 *
 * @see {@link createAuth}
 */
function createAuthContextCustomization<
  TResolve extends Record<string, unknown> = Record<string, never>,
  TCtx extends AuthIdentityCtx & {
    runQuery: (...args: never[]) => Promise<unknown>;
  } = AuthIdentityCtx & { runQuery: (...args: never[]) => Promise<unknown> },
>(
  auth: AuthLike,
  config?: AuthContextConfig<TResolve, TCtx>,
) {
  return {
    args: {},
    input: async (ctx: TCtx, _args: Record<string, never>, _extra?: unknown) => {
      const nativeAuth = ctx.auth;
      const getUserIdentity = nativeAuth.getUserIdentity.bind(nativeAuth);
      const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

      if (resolved === null) {
        if (config?.optional !== true) {
          throw createNotSignedInError();
        }
        return {
          ctx: {
            auth: {
              getUserIdentity,
              ...createUnauthenticatedAuthContext(),
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
 * Extract the resolved `auth` context type from an `auth.ctx()` customization.
 *
 * Use this to type function parameters or variables that receive the
 * enriched auth context produced by `auth.ctx()`. The inferred type includes
 * `userId`, `user`, `groupId`, `role`, `grants`, `getUserIdentity`, and any
 * additional fields added by the `resolve` callback. This is the generic
 * utility for reusing the enriched auth shape without manually duplicating
 * conditional auth types.
 *
 * @typeParam T - An `auth.ctx()` return value (must have an `input` method
 *   that returns `{ ctx: { auth: ... } }`).
 *
 * @example
 * ```ts
 * const authCtx = auth.ctx({
 *   resolve: async (ctx, user) => ({ orgId: user.orgId }),
 * });
 * type Auth = InferAuth<typeof authCtx>;
 * // Auth = { userId: Id<"User">; user: UserDoc; getUserIdentity: ...; orgId: string }
 * ```
 *
 * @see {@link createAuth}
 */
export type InferAuth<
  T extends { input: (...args: never[]) => CustomFunctionInputResult<Record<string, unknown>> },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];
