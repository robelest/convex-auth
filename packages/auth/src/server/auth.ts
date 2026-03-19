/**
 * Auth configuration helpers for Convex Auth.
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";

import type { AuthApiRefs } from "../client/index";
import { Fx } from "./fx";
import { AuthError } from "./fx";
import { Auth as AuthFactory } from "./implementation";
import type { Doc } from "./types";
import type {
  AuthProviderConfig,
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

/** The base auth API surface, without conditional namespaces. */
export type AuthApiBase = {
  signIn: ReturnType<typeof AuthFactory>["signIn"];
  signOut: ReturnType<typeof AuthFactory>["signOut"];
  store: ReturnType<typeof AuthFactory>["store"];
  user: ReturnType<typeof AuthFactory>["auth"]["user"];
  session: ReturnType<typeof AuthFactory>["auth"]["session"];
  provider: ReturnType<typeof AuthFactory>["auth"]["provider"];
  account: ReturnType<typeof AuthFactory>["auth"]["account"];
  group: ReturnType<typeof AuthFactory>["auth"]["group"];
  member: ReturnType<typeof AuthFactory>["auth"]["member"];
  invite: ReturnType<typeof AuthFactory>["auth"]["invite"];
  key: ReturnType<typeof AuthFactory>["auth"]["key"];
  http: ReturnType<typeof AuthFactory>["auth"]["http"];
};

/** Auth API with SSO namespace — present only when `new SSO()` is in providers. */
export type AuthApi = AuthApiBase & {
  sso: ReturnType<typeof AuthFactory>["auth"]["sso"];
};

/**
 * The return type of `createAuth`. Conditional namespaces:
 * - `auth.sso` — only when `new SSO()` is in providers
 * - `auth.clientApi` — typed API refs for the client SDK with capabilities
 */
export type ConvexAuthResult<P extends AuthProviderConfig[]> =
  HasSSO<P> extends true ? AuthApi : AuthApiBase;

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
 * const c = client<InferClientApi<typeof auth>>({ convex, api: { ... } });
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
 * When `new SSO()` is included in providers, `auth.sso` is available
 * on the returned object. Without it, `auth.sso` is absent and
 * accessing it is a TypeScript compile error.
 */
export function createAuth<P extends AuthProviderConfig[]>(
  component: ConvexAuthConfig["component"],
  config: Omit<AuthConfig, "providers"> & { providers: P },
): ConvexAuthResult<P> {
  const authResult = AuthFactory({
    ...config,
    component,
    providers: [...config.providers],
  });

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
    sso: authResult.auth.sso,
    http: authResult.auth.http,
  } as ConvexAuthResult<P>;
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
            const userId = await auth.user.current(ctx);
            if (!userId) {
              return null;
            }
            const user = await auth.user.get(ctx, userId);
            return { userId, user };
          },
          required: async () => {
            const userId = await auth.user.require(ctx);
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
