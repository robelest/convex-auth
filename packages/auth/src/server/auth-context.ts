/**
 * Lightweight auth context resolution — no dependency on `./runtime`.
 *
 * This module contains the pure auth-context helpers that `core/index.ts`
 * and other lightweight consumers can import without pulling in the
 * heavyweight provider / OAuth / crypto machinery from `./runtime`.
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import {
  createUnauthenticatedAuthContext,
  getAuthContext as getResolvedAuthContext,
} from "./context";
import type { Doc } from "./types";

// ============================================================================
// Types
// ============================================================================

/**
 * Config for auth setup. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 */
export type AuthConfig = Omit<import("./types").ConvexAuthConfig, "component">;

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

type PublicAuthContextConfig<TResolve extends Record<string, unknown>, TCtx> = AuthContextConfig<
  TResolve,
  TCtx & AuthResolverCtx
>;

type AuthContextResolver = {
  <TCtx, TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: TCtx,
    config: PublicAuthContextConfig<TResolve, TCtx> & { optional: true },
  ): Promise<ResolvedOptionalAuthContext<TResolve>>;
  <TCtx, TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: TCtx,
    config?: PublicAuthContextConfig<TResolve, TCtx>,
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

/**
 * Minimal auth helper surface required by the context resolvers.
 *
 * This stays exported because `auth.ts` re-exports it for compatibility with
 * existing consumers that reference the low-level context helpers.
 */
export type AuthLike = {
  user: {
    get: (...args: any[]) => Promise<UserDoc | null>;
    getActiveGroup: (...args: any[]) => Promise<string | null>;
    [key: string]: unknown;
  };
  member: {
    inspect: (...args: any[]) => Promise<{
      membership: unknown;
      roleIds: string[];
      grants: string[];
    }>;
    [key: string]: unknown;
  };
};

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
   * Resolve the active group + membership when building `ctx.auth`.
   *
   * The full resolver fires three sequential component reads on every
   * call: `user.get`, `user.getActiveGroup`, `member.inspect`. For
   * handlers that only need `userId` / `user` (e.g. `account:listPasskeys`,
   * profile reads, self-service settings), the second and third reads are
   * pure overhead.
   *
   * Set `group: false` to skip them. `ctx.auth.groupId`, `ctx.auth.role`,
   * and `ctx.auth.grants` come back as `null` / `[]` without any
   * component round-trip. Saves ~10–30ms per auth-gated call on the
   * lightweight path.
   *
   * @defaultValue true
   */
  group?: boolean;
  /**
   * Attach additional derived fields to the auth context after the base auth
   * context is resolved.
   *
   * This callback runs only when a user is authenticated.
   */
  resolve?: (ctx: TCtx, user: UserDoc, auth: AuthContext) => Promise<TResolve> | TResolve;
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
  T extends {
    input: (...args: never[]) => CustomFunctionInputResult<Record<string, unknown>>;
  },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];

// Re-export types that auth.ts needs for its own type definitions
export type {
  AuthContextResolver as _AuthContextResolver,
  AuthContextFactory as _AuthContextFactory,
  AuthContextCustomization as _AuthContextCustomization,
  AuthResolverCtx as _AuthResolverCtx,
  PublicAuthContextConfig as _PublicAuthContextConfig,
  ResolvedAuthContext as _ResolvedAuthContext,
  RequiredAuthContextState as _RequiredAuthContextState,
  OptionalAuthContextState as _OptionalAuthContextState,
};

// ============================================================================
// Functions
// ============================================================================

async function resolveConfiguredAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  config?: AuthContextConfig<TResolve, TCtx>,
): Promise<AuthContext | null> {
  const fallback = () =>
    getResolvedAuthContext(auth, ctx as unknown as Parameters<typeof getResolvedAuthContext>[1], {
      group: config?.group !== false,
    });
  const authOverride = config?.authResolve ? await config.authResolve(ctx, fallback) : undefined;
  return authOverride === undefined ? await fallback() : authOverride;
}

function createNotSignedInError() {
  return new ConvexError({
    code: "NOT_SIGNED_IN",
    message: "Authentication required.",
  });
}

export function assertAuthResolverContext<TCtx>(ctx: TCtx): asserts ctx is TCtx & AuthResolverCtx {
  const candidate = ctx as {
    auth?: { getUserIdentity?: unknown };
    runQuery?: unknown;
  } | null;

  if (
    candidate === null ||
    typeof candidate !== "object" ||
    candidate.auth === undefined ||
    candidate.auth === null ||
    typeof candidate.auth !== "object" ||
    typeof candidate.auth.getUserIdentity !== "function" ||
    typeof candidate.runQuery !== "function"
  ) {
    throw new TypeError(
      "auth.context(ctx) requires a Convex function context with auth.getUserIdentity() and runQuery().",
    );
  }
}

/**
 * Resolve the public auth context for a Convex handler context.
 *
 * This low-level helper underpins `auth.context(...)` and remains exported for
 * compatibility with existing consumers using the server entrypoint.
 */
export async function createPublicAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(auth: AuthLike, ctx: TCtx, config?: AuthContextConfig<TResolve, TCtx>) {
  const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

  if (resolved === null) {
    if (config?.optional !== true) {
      throw createNotSignedInError();
    }
    return createUnauthenticatedAuthContext();
  }

  const extra = config?.resolve ? await config.resolve(ctx, resolved.user, resolved) : {};

  return {
    ...resolved,
    ...extra,
  };
}

/**
 * Create a convex-helpers customization that injects `ctx.auth`.
 *
 * This low-level helper underpins `auth.ctx(...)` and remains exported for
 * compatibility with existing consumers using the server entrypoint.
 */
export function createAuthContextCustomization<
  TResolve extends Record<string, unknown> = Record<string, never>,
  TCtx extends AuthIdentityCtx & {
    runQuery: (...args: never[]) => Promise<unknown>;
  } = AuthIdentityCtx & { runQuery: (...args: never[]) => Promise<unknown> },
>(auth: AuthLike, config?: AuthContextConfig<TResolve, TCtx>) {
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

      const extra = config?.resolve ? await config.resolve(ctx, resolved.user, resolved) : {};

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
