/**
 * Lightweight auth context resolution — no dependency on `./runtime`.
 *
 * This module contains the pure auth context helpers that `core/index.ts`
 * and other lightweight consumers can import without pulling in the
 * heavyweight provider / OAuth / crypto machinery from `./runtime`.
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";

import { ErrorCode } from "../shared/codes";
import {
  createUnauthenticatedAuthContext,
  getAuthContext as getResolvedAuthContext,
} from "./context";
import type { Doc } from "./types";

/**
 * Config for auth setup. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 */
export type AuthConfig<TExtend = {}> = Omit<
  import("./types").ConvexAuthConfig<TExtend>,
  "component"
>;

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
 * is the authenticated auth shape returned by {@link defineAuth().context}.
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
  /**
   * Assert the current user holds the given grant(s); throws
   * `ConvexError({ code: ErrorCode.MISSING_GRANTS })` otherwise. Pass a
   * group-owned document as the second argument to also assert the
   * record belongs to the active group (`code: ErrorCode.FORBIDDEN` if not).
   *
   * For a boolean check, read `grants` directly:
   * `ctx.auth.grants.includes("issues.read")`.
   *
   * @example
   * ```ts
   * ctx.auth.assert("members.manage");
   * ctx.auth.assert(["issues.edit", "issues.move"]);
   * ctx.auth.assert("issues.edit", issueDoc); // group-scoped
   * ```
   */
  assert: (grant: string | readonly string[], doc?: { groupId?: unknown }) => void;
};

/**
 * Nullable auth context returned by `auth.context.optional(ctx)` and injected
 * by `auth.ctx.optional()`.
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
 * const authContext = await auth.context.optional(ctx);
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
  /**
   * Assert the current user holds the given grant(s); throws when
   * missing (or, with a group-owned `doc`, when it is not in the active
   * group). When unauthenticated this always throws. For a boolean
   * check read `grants` directly.
   */
  assert: (grant: string | readonly string[], doc?: { groupId?: unknown }) => void;
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

interface AuthContextResolver {
  <TCtx, TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: TCtx,
    config?: PublicAuthContextConfig<TResolve, TCtx>,
  ): Promise<ResolvedAuthContext<TResolve>>;
}

interface OptionalAuthContextResolver {
  <TCtx, TResolve extends Record<string, unknown> = Record<string, never>>(
    ctx: TCtx,
    config?: PublicAuthContextConfig<TResolve, TCtx>,
  ): Promise<ResolvedOptionalAuthContext<TResolve>>;
}

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

interface AuthContextFactory {
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    config?: AuthContextConfig<TResolve>,
  ): AuthContextCustomization<RequiredAuthContextState & TResolve>;
}

interface OptionalAuthContextFactory {
  <TResolve extends Record<string, unknown> = Record<string, never>>(
    config?: AuthContextConfig<TResolve>,
  ): AuthContextCustomization<OptionalAuthContextState & TResolve>;
}

/**
 * Minimal auth helper surface required by the context resolvers.
 *
 * This stays exported because `auth.ts` re-exports it for compatibility with
 * existing consumers that reference the low-level context helpers.
 */
export type AuthLike = {
  user: {
    get: (...args: never[]) => Promise<UserDoc | null>;
    [key: string]: unknown;
  };
  active: {
    get: (...args: never[]) => Promise<{ groupId: string } | null>;
    [key: string]: unknown;
  };
  member: {
    get: (...args: never[]) => Promise<{
      membership: unknown;
      roleIds: string[];
      grants: string[];
    }>;
    [key: string]: unknown;
  };
};

/**
 * Configuration for {@link defineAuth().ctx} context enrichment.
 *
 * The same config shape is also used by {@link defineAuth().context}.
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
   * Enforce grant(s) inline — equivalent to calling `ctx.auth.assert(...)`
   * at the top of every handler built with this customization. Throws
   * `ConvexError({ code: ErrorCode.MISSING_GRANTS })` when missing.
   */
  assert?: string | readonly string[];
  /**
   * Require an active group; throws `ConvexError({ code: ErrorCode.NO_ACTIVE_GROUP })`
   * when the resolved context has no `groupId`. Reuses the `active` concept.
   */
  active?: true;
  /**
   * Attach additional derived fields to the auth context after the base auth
   * context is resolved.
   *
   * This callback runs only when an authenticated user context is available.
   */
  resolve?: (ctx: TCtx, user: UserDoc, auth: AuthContext) => Promise<TResolve> | TResolve;
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
 * @see {@link defineAuth}
 */
export type InferAuth<
  T extends {
    input: (...args: never[]) => CustomFunctionInputResult<Record<string, unknown>>;
  },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];

type AuthContextFacade = {
  context: AuthContextResolver & { optional: OptionalAuthContextResolver };
  ctx: AuthContextFactory & { optional: OptionalAuthContextFactory };
};

export type {
  AuthContextFacade,
  AuthContextResolver,
  AuthContextFactory,
  OptionalAuthContextResolver,
  OptionalAuthContextFactory,
};

/**
 * Single sanctioned bridge for the resolver's irreducible ctx-family boundary.
 * `getResolvedAuthContext` over-specifies its `runQuery` ctx with the concrete
 * Convex `ComponentReadCtx`, which TypeScript cannot positively unify with the
 * facade's loose `AuthIdentityCtx & AuthQueryCtx` shape. Callers route their
 * generic ctx through this one narrow, typed assertion — naming the exact target
 * via `T` — instead of asserting at each call site.
 */
function bridgeResolverCtx<T>(ctx: object): T {
  return ctx as T;
}

async function resolveConfiguredAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  _config?: AuthContextConfig<TResolve, TCtx>,
): Promise<AuthContext | null> {
  return await getResolvedAuthContext(
    auth,
    bridgeResolverCtx<Parameters<typeof getResolvedAuthContext>[1]>(ctx),
  );
}

function createNotSignedInError() {
  return new ConvexError({
    code: ErrorCode.NOT_SIGNED_IN,
    message: "Authentication required.",
  });
}

/** @internal */
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
 * Enforce the `require` / `active` builder options against a resolved
 * context. Reuses `ctx.auth.assert` for grants so behavior is identical
 * to an inline call.
 *
 * @internal
 */
function enforceAuthRequirements(
  resolved: AuthContext,
  config?: { assert?: string | readonly string[]; active?: true },
) {
  if (config?.active === true && resolved.groupId === null) {
    throw new ConvexError({
      code: ErrorCode.NO_ACTIVE_GROUP,
      message: "An active group is required.",
    });
  }
  if (config?.assert !== undefined) {
    resolved.assert(config.assert);
  }
}

/**
 * This low-level helper underpins `auth.context(...)` and
 * `auth.context.optional(...)`.
 */
async function createPublicAuthContext<
  TCtx extends AuthIdentityCtx & AuthQueryCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: AuthLike,
  ctx: TCtx,
  config: AuthContextConfig<TResolve, TCtx> | undefined,
  optional: boolean,
) {
  const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

  if (resolved === null) {
    if (!optional) {
      throw createNotSignedInError();
    }
    return createUnauthenticatedAuthContext();
  }

  enforceAuthRequirements(resolved, config);

  const extra = config?.resolve ? await config.resolve(ctx, resolved.user, resolved) : {};

  return {
    ...resolved,
    ...extra,
  };
}

/**
 * Create a convex-helpers customization that injects `ctx.auth`.
 *
 * This low-level helper underpins `auth.ctx(...)` and `auth.ctx.optional(...)`.
 */
function createAuthContextCustomization<
  TResolve extends Record<string, unknown> = Record<string, never>,
  TCtx extends AuthIdentityCtx & {
    runQuery: (...args: never[]) => Promise<unknown>;
  } = AuthIdentityCtx & { runQuery: (...args: never[]) => Promise<unknown> },
>(auth: AuthLike, config: AuthContextConfig<TResolve, TCtx> | undefined, optional: boolean) {
  return {
    args: {},
    input: async (ctx: TCtx, _args: Record<string, never>, _extra?: unknown) => {
      const nativeAuth = ctx.auth;
      const getUserIdentity = nativeAuth.getUserIdentity.bind(nativeAuth);
      const resolved = await resolveConfiguredAuthContext(auth, ctx, config);

      if (resolved === null) {
        if (!optional) {
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

      enforceAuthRequirements(resolved, config);

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

/**
 * Build the shared public auth context facade used by both `defineAuth()` and
 * `createAuthContext()`.
 *
 * @internal
 */
export function createAuthContextFacade(auth: AuthLike): AuthContextFacade {
  const context = ((
    ctx: AuthResolverCtx,
    config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>,
  ) => {
    assertAuthResolverContext(ctx);
    return createPublicAuthContext(auth, ctx, config, false);
  }) as AuthContextFacade["context"];

  context.optional = ((
    ctx: AuthResolverCtx,
    config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>,
  ) => {
    assertAuthResolverContext(ctx);
    return createPublicAuthContext(auth, ctx, config, true);
  }) as OptionalAuthContextResolver;

  const ctxFactory = ((config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>) =>
    createAuthContextCustomization(auth, config, false)) as AuthContextFacade["ctx"];

  ctxFactory.optional = ((config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>) =>
    createAuthContextCustomization(auth, config, true)) as OptionalAuthContextFactory;

  return {
    context,
    ctx: ctxFactory,
  };
}
