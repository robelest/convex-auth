/**
 * Lightweight auth context entry point for `@robelest/convex-auth/core`.
 *
 * Provides auth context resolution, user/session/member/group lookups,
 * and authorization helpers without pulling in provider implementations,
 * OAuth, crypto, or sign-in logic.
 *
 * @module
 */

import {
  assertAuthResolverContext,
  createPublicAuthContext,
  createAuthContextCustomization,
  type AuthConfig,
  type AuthContext,
  type AuthContextConfig,
  type AuthLike,
  type OptionalAuthContext,
  type UserDoc,
  type _AuthContextCustomization,
  type _AuthContextFactory,
  type _AuthContextResolver,
  type _AuthResolverCtx,
  type _PublicAuthContextConfig,
  type _ResolvedAuthContext,
} from "../server/auth-context";
import { configDefaults } from "../server/config";
import { createCoreDomains } from "../server/core";
import {
  callInvalidateSessions,
  callCreateAccountFromCredentials,
  callRetrieveAccountWithCredentials,
  callModifyAccount,
} from "../server/mutations/index";
import type {
  ConvexAuthConfig,
  AuthAuthorizationConfig,
} from "../server/types";

export type { AuthContext, OptionalAuthContext, UserDoc, AuthContextConfig };

type AuthContextResolver = _AuthContextResolver;
type AuthContextFactory = _AuthContextFactory;
type AuthContextCustomization<TAuth> = _AuthContextCustomization<TAuth>;
type AuthResolverCtx = _AuthResolverCtx;
type PublicAuthContextConfig<
  TResolve extends Record<string, unknown>,
  TCtx,
> = _PublicAuthContextConfig<TResolve, TCtx>;
type ResolvedAuthContext<TResolve> = _ResolvedAuthContext<TResolve>;

type PublicContextFactory = <
  TCtx,
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  ctx: TCtx,
  config?: PublicAuthContextConfig<TResolve, TCtx>,
) => Promise<ResolvedAuthContext<TResolve>>;

type PublicContextCustomizationFactory = <
  TResolve extends Record<string, unknown> = Record<string, never>,
>(
  config?: AuthContextConfig<TResolve, AuthResolverCtx>,
) => AuthContextCustomization<ResolvedAuthContext<TResolve>>;

/**
 * Create a lightweight auth context object.
 *
 * Returns the same `user`, `session`, `member`, `group`, `account`,
 * `invite`, `key`, `context`, and `ctx` APIs as `createAuth`, but
 * without `signIn`, `signOut`, `store`, `http`, or provider logic.
 *
 * Use this in query/mutation files that only need to resolve the
 * current user — it avoids loading provider, OAuth, and crypto code.
 *
 * @example
 * ```ts
 * // convex/auth-core.ts
 * import { createAuthContext } from "@robelest/convex-auth/core";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuthContext(components.auth);
 *
 * // convex/functions.ts
 * import { auth } from "./auth-core";
 * export const authQuery = customQuery(query, auth.ctx());
 * ```
 */
export function createAuthContext(
  component: ConvexAuthConfig["component"],
  config?: Omit<AuthConfig, "providers"> & {
    authorization?: AuthAuthorizationConfig;
  },
) {
  const fullConfig = configDefaults({
    component,
    providers: [],
    ...config,
  });

  const INVITE_TOKEN_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const INVITE_TOKEN_LENGTH = 48;

  const enrichCtx = <T>(ctx: T) => ctx;

  const domains = createCoreDomains({
    config: fullConfig,
    callInvalidateSessions,
    callCreateAccountFromCredentials,
    callRetrieveAccountWithCredentials,
    callModifyAccount,
    getEnrichCtx: () => enrichCtx,
    inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
    inviteTokenLength: INVITE_TOKEN_LENGTH,
    // signInForProvider intentionally omitted — core doesn't support provider sign-in
  });

  const authLike: AuthLike = {
    user: domains.user,
    member: domains.member,
  };

  return {
    user: domains.user,
    session: domains.session,
    account: domains.account,
    group: domains.group,
    member: domains.member,
    invite: domains.invite,
    key: domains.key,

    context: ((ctx, config) => {
      assertAuthResolverContext(ctx);
      return createPublicAuthContext(authLike, ctx, config);
    }) as PublicContextFactory as AuthContextResolver,

    ctx: ((config?: AuthContextConfig<Record<string, unknown>, AuthResolverCtx>) =>
      createAuthContextCustomization(authLike, config)) as PublicContextCustomizationFactory as AuthContextFactory,
  };
}
