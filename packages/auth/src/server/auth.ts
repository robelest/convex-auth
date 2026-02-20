/**
 * The `Auth` class — the main entry point for Convex Auth.
 *
 * Main entry point for authentication and authorization helpers:
 *
 * ```ts
 * // convex/auth.ts
 * import { Auth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = new Auth(components.auth, {
 *   providers: [{ id: "google", type: "oauth" as const }],
 *   email: {
 *     from: "My App <noreply@example.com>",
 *     send: async (_ctx, { from, to, subject, html }) => {
 *       await fetch("https://api.resend.com/emails", {
 *         method: "POST",
 *         headers: {
 *           Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
 *           "Content-Type": "application/json",
 *         },
 *         body: JSON.stringify({ from, to, subject, html }),
 *       });
 *     },
 *   },
 * });
 * export const { signIn, signOut, store } = auth;
 * ```
 *
 * @module
 */

import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";
import type { Doc } from "./implementation/types";
import type { ComponentApi as AuthComponentApi } from "../component/_generated/component";
import { Auth as AuthFactory } from "./implementation/index";
import type { ConvexAuthConfig } from "./types";
import { defaultMagicLinkEmail } from "./templates";
import emailProvider from "../providers/email";
import { throwAuthError } from "./errors";

// ============================================================================
// Types
// ============================================================================

/**
 * Config for the Auth class. Extends the standard auth config
 * minus `component` (which is passed as the first constructor argument).
 *
 * When `email` is configured, the library auto-registers a
 * magic link provider (`id: "email"`) for user-facing sign-in.
 */
export type AuthClassConfig = Omit<ConvexAuthConfig, "component">;

// ============================================================================
// Auth class
// ============================================================================

/**
 * Main entry point for Convex Auth. Instantiate with your component
 * reference and config to get all the exports you need.
 *
 * ```ts
 * export const auth = new Auth(components.auth, {
 *   providers: [google, password],
 *   email: {
 *     from: "My App <noreply@example.com>",
 *     send: (ctx, params) => resend.sendEmail(ctx, params),
 *   },
 * });
 * export const { signIn, signOut, store } = auth;
 * ```
 */
export class Auth {
  /** The inner `auth` helper object from AuthFactory() */
  private readonly _auth: ReturnType<typeof AuthFactory>["auth"];
  /** The signIn action — export this from your convex/auth.ts */
  public readonly signIn: ReturnType<typeof AuthFactory>["signIn"];
  /** The signOut action — export this from your convex/auth.ts */
  public readonly signOut: ReturnType<typeof AuthFactory>["signOut"];
  /** The store internal mutation — export this from your convex/auth.ts */
  public readonly store: ReturnType<typeof AuthFactory>["store"];

  // ---- Proxied auth helper sub-objects ----
  /** User helpers: `.current(ctx)`, `.require(ctx)`, `.get(ctx, userId)`, `.patch(ctx, userId, data)`, `.viewer(ctx)`, `.group.list(ctx, ...)`, `.group.get(ctx, ...)` */
  get user() { return this._auth.user; }
  /** Session helpers: `.current(ctx)`, `.invalidate(ctx, { userId, except? })` */
  get session() { return this._auth.session; }
  /** Provider helpers: `.signIn(ctx, provider, args)` */
  get provider() { return this._auth.provider; }
  /** Account helpers: `.create(ctx, args)`, `.get(ctx, args)`, `.update(ctx, args)` */
  get account() { return this._auth.account; }
  /** Group helpers: `.create(ctx, ...)`, `.get(ctx, id)`, `.list(ctx, ...)`, `.update(ctx, ...)`, `.delete(ctx, id)`, `.member.*` */
  get group() { return this._auth.group; }
  /** Invite helpers: `.create(ctx, ...)`, `.get(ctx, id)`, `.list(ctx, ...)`, `.accept(ctx, ...)`, `.revoke(ctx, id)` */
  get invite() { return this._auth.invite; }
  /** Passkey helpers: `.list(ctx, { userId })`, `.rename(ctx, id, name)`, `.remove(ctx, id)` */
  get passkey() { return this._auth.passkey; }
  /** TOTP helpers: `.list(ctx, { userId })`, `.remove(ctx, id)` */
  get totp() { return this._auth.totp; }
  /** API key helpers: `.create(ctx, ...)`, `.verify(ctx, rawKey)`, `.list(ctx, ...)`, `.get(ctx, id)`, `.update(ctx, ...)`, `.revoke(ctx, id)`, `.remove(ctx, id)` */
  get key() { return this._auth.key; }

  /**
   * @param component - The auth component reference from `components.auth`.
   * @param config - Auth configuration (providers, email transport, session, JWT, callbacks).
   */
  constructor(component: AuthComponentApi, config: AuthClassConfig) {
    const emailTransport = config.email;
    const providers = [...config.providers];

    // Auto-register user-facing magic link provider when email is configured.
    // Skipped if the user already registered their own provider with id "email".
    const hasUserEmailProvider = providers.some(
      (p) => typeof p === "object" && "id" in p && p.id === "email",
    );
    if (emailTransport && !hasUserEmailProvider) {
      providers.push(
        emailProvider({
          id: "email",
          from: emailTransport.from,
          maxAge: 60 * 60 * 24, // 24 hours
          authorize: undefined, // Magic link — no OTP email check needed
          async sendVerificationRequest({ identifier, url }, ctx) {
            if (!ctx) {
              throwAuthError("MISSING_ACTION_CONTEXT");
            }
            const { host } = new URL(url);
            await emailTransport.send(ctx, {
              from: emailTransport.from,
              to: identifier,
              subject: `Sign in to ${host}`,
              html: defaultMagicLinkEmail(url, host),
            });
          },
        }),
      );
    }

    // Initialize the core AuthFactory()
    const authResult = AuthFactory({
      ...config,
      component,
      providers,
    });

    this._auth = authResult.auth;
    this.signIn = authResult.signIn;
    this.signOut = authResult.signOut;
    this.store = authResult.store;

  }

  /** HTTP namespace — route registration and Bearer-authenticated endpoints. */
  get http() {
    return this._auth.http;
  }
}

// ============================================================================
// AuthCtx — ctx enrichment for customQuery / customMutation
// ============================================================================

/**
 * The shape of a user document from the auth component's `user` table.
 *
 * Includes system fields (`_id`, `_creationTime`) plus the schema fields
 * (`name`, `email`, `image`, `extend`, etc.).
 */
export type UserDoc = Doc<"user">;

/**
 * Configuration for auth context enrichment.
 *
 * @typeParam TResolve - The shape returned by the `resolve` callback.
 *   Inferred automatically — you usually don't need to supply this manually.
 */
export type AuthCtxConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
> = {
  /**
   * When `true`, unauthenticated requests set `ctx.auth.userId` and
   * `ctx.auth.user` to `null` instead of throwing.
   *
   * @default false
   */
  optional?: boolean;
  /**
   * Resolve additional context after authentication succeeds (e.g.
   * group/role for multi-tenant apps). The returned object is spread
   * into `ctx.auth`.
   */
  resolve?: (
    ctx: any,
    user: UserDoc,
  ) => Promise<TResolve> | TResolve;
};

/**
 * Create a `convex-helpers`–compatible customization object that
 * enriches `ctx.auth` with the authenticated user's data.
 *
 * Standalone function (not a class method) because Convex's bundler
 * can trace `export const x = fn(instance)` but not `instance.method()`.
 *
 * ### Basic usage (with `convex-helpers`)
 *
 * ```ts
 * // convex/functions.ts
 * import { customQuery, customMutation } from "convex-helpers/server/customFunctions";
 * import { query as rawQuery, mutation as rawMutation } from "./_generated/server";
 * import { AuthCtx } from "\@robelest/convex-auth/component";
 * import { auth } from "./auth";
 *
 * const authCtx = AuthCtx(auth);
 *
 * export const query = customQuery(rawQuery, authCtx);
 * export const mutation = customMutation(rawMutation, authCtx);
 * ```
 *
 * Then in any function file:
 *
 * ```ts
 * // convex/messages.ts
 * import { query, mutation } from "./functions";
 *
 * export const list = query({
 *   args: {},
 *   handler: async (ctx) => {
 *     // ctx.auth.userId and ctx.auth.user are already resolved
 *     return ctx.db.query("messages").collect();
 *   },
 * });
 * ```
 *
 * ### Optional auth (public routes)
 *
 * ```ts
 * export const publicQuery = customQuery(rawQuery, AuthCtx(auth, { optional: true }));
 * // ctx.auth.userId is null when unauthenticated
 * ```
 *
 * ### Multi-tenant with group resolution
 *
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (ctx, user) => {
 *     const groupId = user?.extend?.lastActiveGroup;
 *     const membership = await auth.user.group.get(ctx, {
 *       userId: user._id,
 *       groupId,
 *     });
 *     return { groupId, role: membership?.role ?? "member" };
 *   },
 * });
 * // ctx.auth.groupId and ctx.auth.role available in handlers
 * ```
 *
 * @param auth - The `Auth` class instance from your `convex/auth.ts`.
 * @param config - Optional configuration for optional auth and group resolution.
 * @returns A `{ args, input }` customization object compatible with
 *          `customQuery` / `customMutation` from `convex-helpers`.
 */
/**
 * Overload: optional auth — `userId` and `user` may be `null`.
 */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: Auth,
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
        userId: GenericId<"user"> | null;
        user: UserDoc | null;
      } & TResolve;
    };
    args: {};
  }>;
};
/**
 * Overload: required auth (default) — `userId` and `user` are never `null`.
 */
export function AuthCtx<
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  auth: Auth,
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
        userId: GenericId<"user">;
        user: UserDoc;
      } & TResolve;
    };
    args: {};
  }>;
};
// Implementation
export function AuthCtx(auth: Auth, config?: AuthCtxConfig<any>) {
  const authHelper = (auth as any)._auth;

  return {
    args: {},
    input: async (ctx: any, _args: any, _extra?: any) => {
      const nativeAuth = ctx.auth;

      if (config?.optional) {
        const userId = await authHelper.user.current(ctx);
        if (!userId) {
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
        const user = await authHelper.user.get(ctx, userId);
        const extra = config.resolve
          ? await config.resolve(ctx, user)
          : {};
        return {
          ctx: {
            auth: {
              getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
              userId,
              user,
              ...extra,
            },
          },
          args: {},
        };
      }

      // Required mode (default): throws NOT_SIGNED_IN
      const userId = await authHelper.user.require(ctx);
      const user = await authHelper.user.get(ctx, userId);
      const extra = config?.resolve
        ? await config.resolve(ctx, user)
        : {};

      return {
        ctx: {
          auth: {
            getUserIdentity: nativeAuth.getUserIdentity.bind(nativeAuth),
            userId,
            user,
            ...extra,
          },
        },
        args: {},
      };
    },
  };
}

/**
 * Extract the `ctx.auth` shape from an {@link AuthCtx} result.
 *
 * Follows the same pattern as `Infer<typeof validator>` in Convex
 * and `z.infer<typeof schema>` in Zod.
 *
 * @example
 * ```ts
 * const authCtx = AuthCtx(auth, {
 *   resolve: async (ctx, user) => ({ groupId: "abc", role: "admin" }),
 * });
 * type MyAuth = InferAuth<typeof authCtx>;
 * // { getUserIdentity, userId, user, groupId: string, role: string }
 * ```
 */
export type InferAuth<
  T extends { input: (...args: any[]) => Promise<{ ctx: { auth: any } }> },
> = Awaited<ReturnType<T["input"]>>["ctx"]["auth"];
