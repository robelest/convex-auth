/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import type { AuthApiRefs } from "../client/index";
import { createAuthContextFacade } from "./facade";
import type {
  AuthConfig,
  AuthContext,
  AuthContextConfig,
  AuthContextFacade,
  AuthContextFactory,
  AuthContextResolver,
  AuthLike,
  InferAuth,
  OptionalAuthContext,
  UserDoc,
} from "./facade";
import { Auth as AuthFactory } from "./runtime";
import { buildAuthValidators } from "./validators";
import type { AuthExtendValidators, AuthValidators } from "./validators";
import type {
  AuthAuthorizationConfig,
  AuthGrant,
  AuthProviderConfig,
  AuthRoleId,
  ConvexAuthConfig,
  HasDeviceProvider,
  HasPasskeyProvider,
  HasSSO,
  HasTotpProvider,
} from "./types";

// Re-export for backward compat (other files import these from auth.ts)
export type {
  AuthConfig,
  AuthContext,
  AuthContextConfig,
  InferAuth,
  OptionalAuthContext,
  UserDoc,
};
export type { AuthExtendValidators, AuthValidators };


// ============================================================================
// Types
// ============================================================================

type MemberApiWithAuthorization<TAuthorization extends AuthAuthorizationConfig | undefined> = Omit<
  ReturnType<typeof AuthFactory>["auth"]["member"],
  "create" | "list" | "update" | "inspect" | "require"
> & {
  create: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["create"]>[0],
    data: {
      groupId: string;
      userId: string;
      roleIds?: AuthRoleId<TAuthorization>[];
      status?: string;
      extend?: Record<string, unknown>;
    },
  ) => Promise<{ memberId: string }>;
  list: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["list"]>[0],
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
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["update"]>[0],
    memberId: string,
    data: Record<string, unknown> & { roleIds?: AuthRoleId<TAuthorization>[] },
  ) => Promise<{ memberId: string }>;
  inspect: ReturnType<typeof AuthFactory>["auth"]["member"]["inspect"];
  require: (
    ctx: Parameters<ReturnType<typeof AuthFactory>["auth"]["member"]["require"]>[0],
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
 * `member`, `invite`, `group`, `key`, and `request` — that are
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
  TExtend extends AuthExtendValidators = {},
> = {
  /**
   * Convex `returns:` validators for the auth read surface.
   *
   * Set these as a function's `returns:` so client-side `useQuery`
   * inference flows end-to-end without hand-rolled validators or DTO
   * mappers. The `extend` field of each document carries the shape
   * supplied via `createAuth({ extend: { ... } })`.
   *
   * Available validators:
   * - `v.user` / `v.group` / `v.member` — single documents (extend-aware).
   * - `v.invite` — a single group invite document.
   * - `v.viewer` — `User | null`, for a current-user query.
   * - `v.list(item)` — wraps an item validator in `{ items, nextCursor }`.
   *
   * Compose these for richer reads — e.g. a current user plus their
   * memberships and groups — using the existing `auth.user.viewer`,
   * `auth.member.list`, and `auth.group.get` facade methods.
   *
   * @example
   * ```ts
   * export const viewer = authQuery({
   *   returns: auth.v.viewer,
   *   handler: (ctx) => ctx.auth.user.viewer(ctx),
   * });
   *
   * export const groups = authQuery({
   *   returns: v.union(
   *     v.object({
   *       ...auth.v.user.fields,
   *       memberships: v.array(auth.v.member),
   *       groups: v.array(auth.v.group),
   *     }),
   *     v.null(),
   *   ),
   *   handler: async (ctx) => {
   *     const me = await ctx.auth.user.viewer(ctx);
   *     if (me === null) return null;
   *     const { items: memberships } = await ctx.auth.member.list(ctx, {
   *       where: { userId: me._id },
   *     });
   *     const groups = await ctx.auth.group.get(
   *       ctx,
   *       memberships.map((m) => m.groupId),
   *     );
   *     return { ...me, memberships, groups };
   *   },
   * });
   * ```
   */
  v: AuthValidators<TExtend>;
  signIn: ReturnType<typeof AuthFactory>["signIn"];
  signOut: ReturnType<typeof AuthFactory>["signOut"];
  store: ReturnType<typeof AuthFactory>["store"];
  http: ReturnType<typeof AuthFactory>["http"];
  user: ReturnType<typeof AuthFactory>["auth"]["user"];
  session: ReturnType<typeof AuthFactory>["auth"]["session"];
  provider: ReturnType<typeof AuthFactory>["auth"]["provider"];
  account: ReturnType<typeof AuthFactory>["auth"]["account"];
  group: ReturnType<typeof AuthFactory>["auth"]["group"] & {
    /** Current user's active-group selection (`get` / `set` / `clear`). */
    active: ReturnType<typeof AuthFactory>["auth"]["active"];
  };
  member: MemberApiWithAuthorization<TAuthorization>;
  invite: ReturnType<typeof AuthFactory>["auth"]["invite"];
  key: ReturnType<typeof AuthFactory>["auth"]["key"];
  request: ReturnType<typeof AuthFactory>["auth"]["request"];
  /**
   * Resolve the current request's auth context. Framework-agnostic — use
   * this in fluent-convex middleware, custom wrappers, or anywhere you
   * need the current `{ userId, user, groupId, role, grants }` object.
   *
   * This is the authorization-enrichment path. For native identity claims
   * already present on the JWT, prefer `ctx.auth.getUserIdentity()`.
   *
   * Throws a structured `ConvexError` when unauthenticated by default.
   * Pass `{ optional: true }` to get a null-shaped auth object instead.
   *
   * @param ctx - Convex query, mutation, or action context.
   * @param config - Optional auth resolution config. Supports `optional` and
   *   `resolve`.
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
  TExtend extends AuthExtendValidators = {},
> = AuthApiBase<TAuthorization, TExtend> & {
  group: AuthApiBase<TAuthorization, TExtend>["group"] & {
    sso: PublicGroupSsoApi;
  };
};

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
  TExtend extends AuthExtendValidators = {},
> = HasSSO<P> extends true
  ? AuthApi<TAuthorization, TExtend>
  : AuthApiBase<TAuthorization, TExtend>;

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
    ? AuthApiRefs<HasPasskeyProvider<P>, HasTotpProvider<P>, HasDeviceProvider<P>>
    : AuthApiRefs;

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
export function createAuth<
  P extends AuthProviderConfig[],
  TAuthorization extends AuthAuthorizationConfig | undefined = undefined,
  TExtend extends AuthExtendValidators = {},
>(
  component: ConvexAuthConfig["component"],
  config: Omit<AuthConfig, "providers" | "authorization"> & {
    providers: P;
    authorization?: TAuthorization;
    /**
     * Validators for the `extend` field of each table. Drives both the
     * inferred type of `auth.v.*` (so `viewer.extend.<field>` is typed)
     * and runtime validation of consumer return shapes.
     *
     * @example
     * ```ts
     * createAuth(components.auth, {
     *   providers: [password()],
     *   extend: { User: v.object({ stripeCustomerId: v.optional(v.string()) }) },
     * });
     * ```
     */
    extend?: TExtend;
  },
): ConvexAuthResult<P, TAuthorization, TExtend> {
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

  type SetGroupConnectionDomains = PublicGroupSsoApi["connection"]["domain"]["set"];
  type GroupConnectionDomainInput = Array<{
    domain: string;
    isPrimary?: boolean;
  }>;
  const setGroupConnectionDomains: PublicGroupSsoApi["connection"]["domain"]["set"] = async (
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
    const primaryCount = nextDomains.filter((entry) => entry.isPrimary).length;
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
        await (
          ctx as {
            runMutation: GenericActionCtx<GenericDataModel>["runMutation"];
          }
        ).runMutation(component.sso.connection.domain.verify, {
          domainId,
          verifiedAt: current.verifiedAt,
        });
      }
    }

    const updatedDomains = await domainApi.list(ctx, connectionId);
    return {
      connectionId,
      domains: updatedDomains.map((domain: (typeof updatedDomains)[number]) => ({
        domainId: domain._id,
        domain: domain.domain,
        isPrimary: Boolean(domain.isPrimary),
        verified: domain.verifiedAt !== undefined,
        verifiedAt: domain.verifiedAt ?? null,
      })),
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
    v: buildAuthValidators(config.extend ?? ({} as TExtend)),
    signIn: authResult.signIn,
    signOut: authResult.signOut,
    store: authResult.store,
    http: authResult.http,
    user: authResult.auth.user,
    session: authResult.auth.session,
    provider: authResult.auth.provider,
    account: authResult.auth.account,
    group: {
      ...authResult.auth.group,
      sso: publicGroupSso,
      active: authResult.auth.active,
    },
    member: authResult.auth.member,
    invite: authResult.auth.invite,
    key: authResult.auth.key,
    request: authResult.auth.request,

    ...(createAuthContextFacade(authResult.auth as AuthLike) as AuthContextFacade),
  } as unknown as ConvexAuthResult<P, TAuthorization>;
}
