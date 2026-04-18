import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError } from "convex/values";
import type { Value } from "convex/values";
import { v } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import { redirectToParamCookie, useRedirectToParam } from "./cookies";
import { createCoreDomains } from "./core";
import { GetProviderOrThrowFunc } from "./crypto";
import { requireEnv } from "./env";
import {
  addAuthRoutes,
  addOpenIdRoutes,
  convertErrorsToResponse,
  createHttpAction,
  createHttpContext,
  createHttpRoute,
  getCookies,
} from "./http";
import { logError, log, LOG_LEVELS } from "./log";
import {
  callCreateAccountFromCredentials,
  callInvalidateSessions,
  callModifyAccount,
  callRetrieveAccountWithCredentials,
  callSignOut,
  callUserOAuth,
  callVerifierSignature,
  storeArgs,
  storeImpl,
} from "./mutations/index";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "./oauth/runtime";
import type { AuthProfile } from "./payloads";
import { payloadRecordValidator } from "./payloads";
import { generateRandomString, sha256 } from "./random";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { encryptSecret } from "./secret";
import { createGroupService } from "./services/group";
import { resolveServerServices } from "./services/resolve";
import { createGroupConnectionDomain } from "./sso/domain";
import { addGroupHttpRuntime } from "./sso/http";
import { normalizeGroupConnectionPolicy } from "./sso/policy";
import type {
  ConvexAuthConfig,
  FunctionReferenceFromExport,
  OAuthMaterializedConfig,
  SSOProviderConfig,
  Tokens,
} from "./types";
import { MutationCtx } from "./types";
import { siteUrlsFromEnv } from "./url";

const GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND = "oidc_client_secret" as const;

const convexError = (data: Record<string, Value>) => new ConvexError(data);

/**
 * The type of the signIn Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
 */
export type SignInAction = FunctionReferenceFromExport<ReturnType<typeof Auth>["signIn"]>;

/** @internal */
export type SignInActionResult =
  | { kind: "signedIn"; tokens: Tokens | null }
  | { kind: "redirect"; redirect: string; verifier: string }
  | { kind: "started" }
  | {
      kind: "passkeyOptions";
      options: Record<string, unknown>;
      verifier: string;
    }
  | { kind: "totpRequired"; verifier: string }
  | {
      kind: "totpSetup";
      totpSetup: { uri: string; secret: string; totpId: string };
      verifier: string;
    }
  | {
      kind: "deviceCode";
      deviceCode: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval: number;
      };
    };
/**
 * The type of the signOut Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
 */
export type SignOutAction = FunctionReferenceFromExport<ReturnType<typeof Auth>["signOut"]>;

/**
 * Configure the Convex Auth library. Returns an object with
 * functions and `auth` helper. You must export the functions
 * from `convex/auth.ts` to make them callable:
 *
 * ```ts filename="convex/auth.ts"
 * import { createAuth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuth(components.auth, {
 *   providers: [],
 * });
 * export const { signIn, signOut, store } = auth;
 * ```
 *
 * @returns An object with fields you should reexport from your
 *          `convex/auth.ts` file.
 */
export function Auth(config_: ConvexAuthConfig) {
  const services = resolveServerServices(config_);
  const config = services.config;
  const hasOAuth = config.providers.some((provider) => provider.type === "oauth");
  const hasSSO = config.providers.some((provider) => provider.type === "sso");
  const ssoProvider = config.providers.find(
    (provider): provider is SSOProviderConfig => provider.type === "sso",
  );
  const getProviderOrThrow: GetProviderOrThrowFunc = services.providerRegistry.getProviderOrThrow;
  const INVITE_TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const INVITE_TOKEN_LENGTH = 48;

  const GROUP_CONNECTION_ROUTE_BASE = "/api/auth/connections";
  const group = createGroupService({ config, sha256 });

  type AuthRuntimeBase = ReturnType<typeof createCoreDomains> & {
    sso: ReturnType<typeof createGroupConnectionDomain>;
  };

  const authBase: AuthRuntimeBase = {
    ...createCoreDomains({
      config,
      callInvalidateSessions,
      callCreateAccountFromCredentials,
      callRetrieveAccountWithCredentials,
      callModifyAccount,
      getEnrichCtx: () => enrichCtx,
      inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
      inviteTokenLength: INVITE_TOKEN_LENGTH,
    }),
    /**
     * SSO namespace — group connection management, domain, OIDC,
     * SAML, SCIM, audit, and webhook helpers.
     */
    sso: createGroupConnectionDomain({
      config,
      getGroupConnectionSecret: group.getGroupConnectionSecret,
      loadConnectionOrThrow: group.loadConnectionOrThrow,
      validateGroupConnectionPolicy: group.validateGroupConnectionPolicy,
      recordGroupAuditEvent: group.recordGroupAuditEvent,
      emitGroupWebhookDeliveries: group.emitGroupWebhookDeliveries,
      connectionNotFoundError: "Connection not found.",
      GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND,
      requireEnv,
      generateRandomString,
      INVITE_TOKEN_ALPHABET,
      sha256,
      encryptSecret,
      loadGroupPolicyOrThrow: group.loadGroupPolicyOrThrow,
    }),
  };

  // HTTP wiring stays local to the factory because it still depends on a
  // dense mix of OAuth, SAML, SCIM, cookie, and response helpers.
  const getDefaultCorsOrigins = () => siteUrlsFromEnv().allowedUrls.map((u) => new URL(u).origin);

  const http = {
    /**
     * Register core HTTP routes for JWT verification and OAuth sign-in.
     *
     * ```ts
     * import { httpRouter } from "convex/server";
     * import { auth } from "./auth";
     *
     * const http = httpRouter();
     *
     * auth.http.add(http);
     *
     * export default http;
     * ```
     *
     * The following routes are handled always:
     *
     * - `/.well-known/openid-configuration`
     * - `/.well-known/jwks.json`
     *
     * The following routes are handled if OAuth is configured:
     *
     * - `/api/auth/signin/*`
     * - `/api/auth/callback/*`
     *
     * @param http your HTTP router
     */
    add: (http: HttpRouter) => {
      addOpenIdRoutes(http, {
        getIssuer: () => requireEnv("CONVEX_SITE_URL"),
        getJwks: () => requireEnv("JWKS"),
      });

      addGroupHttpRuntime({
        http,
        hasSSO,
        auth: authBase as unknown as Parameters<typeof addGroupHttpRuntime>[0]["auth"],
        config,
        routeBase: GROUP_CONNECTION_ROUTE_BASE,
        requireEnv,
        loadActiveConnectionSamlOrThrow: group.loadActiveConnectionSamlOrThrow,
        loadConnectionOidcOrThrow: group.loadConnectionOidcOrThrow,
        getGroupConnectionScimContext: group.getGroupConnectionScimContext,
        loadGroupPolicyOrThrow: group.loadGroupPolicyOrThrow,
        normalizeGroupConnectionPolicy,
        recordGroupAuditEvent: group.recordGroupAuditEvent,
        emitGroupWebhookDeliveries: group.emitGroupWebhookDeliveries,
        generateRandomString,
        inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
        callUserOAuth,
        callVerifierSignature,
        sharedOidcRedirectURI: ssoProvider?.redirectURI,
      });

      if (hasOAuth) {
        addAuthRoutes(http, {
          handleSignIn: convertErrorsToResponse(400, async (ctx, request) => {
            const url = new URL(request.url);
            const pathParts = url.pathname.split("/");
            const providerId = pathParts[pathParts.length - 1]!;
            if (providerId === null) {
              throw convexError({
                code: "OAUTH_MISSING_PROVIDER",
                message: "Missing OAuth provider ID.",
              });
            }
            const verifier = url.searchParams.get("code");
            if (verifier === null) {
              throw convexError({
                code: "OAUTH_MISSING_VERIFIER",
                message: "Missing sign-in verifier.",
              });
            }
            const provider = getProviderOrThrow(providerId);

            const oauthConfig = provider as OAuthMaterializedConfig;
            const { redirect, cookies, signature } = await createOAuthAuthorizationURL(
              providerId,
              oauthConfig,
            );

            await callVerifierSignature(ctx, {
              verifier,
              signature,
            });

            const redirectTo = url.searchParams.get("redirectTo");
            if (redirectTo !== null) {
              cookies.push(redirectToParamCookie(providerId, redirectTo));
            }

            const headers = new Headers({ Location: redirect });
            for (const { name, value, options } of cookies) {
              headers.append("Set-Cookie", serializeCookie(name, value, options));
            }

            return new Response(null, { status: 302, headers });
          }),
          handleCallback: async (ctx, request) => {
            const url = new URL(request.url);
            const callbackPathParts = new URL(request.url).pathname.split("/");
            const providerId = callbackPathParts[callbackPathParts.length - 1];
            if (!providerId) {
              throw convexError({
                code: "OAUTH_MISSING_PROVIDER",
                message: "Missing OAuth provider ID.",
              });
            }
            log(LOG_LEVELS.DEBUG, "Handling OAuth callback for provider:", providerId);
            const provider = getProviderOrThrow(providerId);

            const cookies = getCookies(request);

            const maybeRedirectTo = useRedirectToParam(provider.id, cookies);

            const destinationUrl = await redirectAbsoluteUrl(config, {
              redirectTo: maybeRedirectTo?.redirectTo,
            });

            const params = url.searchParams;

            if (
              request.headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")
            ) {
              const formData = await request.formData();
              formData.forEach((value, key) => {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              });
            }

            try {
              const oauthConfig = provider as OAuthMaterializedConfig;
              const result = await handleOAuthCallback(
                providerId,
                oauthConfig,
                Object.fromEntries(params.entries()),
                cookies,
              );
              const oauthCookies = result.cookies;
              const { id: profileId, ...profileData } = result.profile;
              const { signature } = result;

              const verificationCode = await callUserOAuth(ctx, {
                provider: providerId,
                providerAccountId: profileId,
                profile: profileData as AuthProfile,
                signature,
              });

              const redirUrl = setURLSearchParam(destinationUrl, "code", verificationCode);
              const redirHeaders = new Headers({ Location: redirUrl });
              redirHeaders.set("Cache-Control", "must-revalidate");
              for (const { name, value, options } of [
                ...oauthCookies,
                ...(maybeRedirectTo !== null ? [maybeRedirectTo.updatedCookie] : []),
              ] as Array<{
                name: string;
                value: string;
                options: Parameters<typeof serializeCookie>[2];
              }>) {
                redirHeaders.append("Set-Cookie", serializeCookie(name, value, options));
              }
              return new Response(null, {
                status: 302,
                headers: redirHeaders,
              });
            } catch (error) {
              logError(error);
              const respHeaders = new Headers({
                Location: destinationUrl,
              });
              for (const { name, value, options } of maybeRedirectTo !== null
                ? [maybeRedirectTo.updatedCookie]
                : []) {
                respHeaders.append("Set-Cookie", serializeCookie(name, value, options));
              }
              return new Response(null, {
                status: 302,
                headers: respHeaders,
              });
            }
          },
        });
      }
    },

    /**
     * Resolve mixed HTTP auth for a raw `httpAction`.
     *
     * Checks session auth first, then falls back to `Authorization: Bearer sk_*`
     * API keys. This is the low-level helper for endpoints that intentionally
     * accept either browser sessions or API keys.
     * Pass `{ optional: true }` to get a null-shaped auth object instead of a
     * `NOT_SIGNED_IN` error.
     *
     * ```ts
     * http.route({
     *   path: "/api/data",
     *   method: "GET",
     *   handler: httpAction(async (ctx, request) => {
     *     const authContext = await auth.http.context(ctx, request);
     *     return Response.json({
     *       userId: authContext.userId,
     *       source: authContext.source,
     *     });
     *   }),
     * });
     * ```
     */
    context: createHttpContext(authBase as unknown as Parameters<typeof createHttpContext>[0]),

    /**
     * Wrap an HTTP action handler with Bearer token authentication.
     *
     * Extracts the `Authorization: Bearer <key>` header, verifies the
     * API key via `auth.key.verify()`, and injects `ctx.key` with the
     * verified key info. Returns structured JSON error responses for
     * missing/invalid/revoked/expired/rate-limited keys.
     *
     * If the handler returns a plain object, it is auto-wrapped in a
     * `200 JSON` response. If it returns a `Response`, CORS headers
     * are merged and the response is passed through.
     *
     * ```ts
     * const handler = auth.http.action(async (ctx, request) => {
     *   const data = await ctx.runQuery(api.data.get, { userId: ctx.key.userId });
     *   return { data };
     * });
     * http.route({ path: "/api/data", method: "GET", handler });
     * ```
     *
     * @param handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
     * @param options.scope - Optional scope check; returns 403 if the key lacks permission.
     * @param options.cors - CORS config; defaults to site URLs from environment.
     */
    action: createHttpAction(
      authBase as unknown as Parameters<typeof createHttpAction>[0],
      getDefaultCorsOrigins,
    ),

    /**
     * Register a Bearer-authenticated route **and** its OPTIONS preflight
     * in a single call.
     *
     * ```ts
     * auth.http.route(http, {
     *   path: "/api/messages",
     *   method: "POST",
     *   handler: async (ctx, request) => {
     *     const { body } = await request.json();
     *     await ctx.runMutation(internal.messages.sendAsUser, {
     *       userId: ctx.key.userId,
     *       body,
     *     });
     *     return { success: true };
     *   },
     * });
     * ```
     *
     * @param http - The Convex HTTP router.
     * @param routeConfig.path - The URL path to match.
     * @param routeConfig.method - HTTP method (GET, POST, PUT, PATCH, DELETE).
     * @param routeConfig.handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
     * @param routeConfig.scope - Optional scope check; returns 403 if the key lacks permission.
     * @param routeConfig.cors - CORS config; defaults to site URLs from environment.
     */
    route: createHttpRoute(
      createHttpAction(
        authBase as unknown as Parameters<typeof createHttpAction>[0],
        getDefaultCorsOrigins,
      ),
      getDefaultCorsOrigins,
    ),
  };

  const auth = Object.assign(authBase, { http });

  const enrichCtx = <DataModel extends GenericDataModel>(ctx: GenericActionCtx<DataModel>) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      config,
      account: auth.account,
      session: auth.session,
      member: auth.member,
      provider: auth.provider,
    },
  });

  return {
    /**
     * Helper for configuring HTTP actions.
     */
    auth,
    /**
     * Action called by the client to sign the user in.
     *
     * Also used for refreshing the session.
     */
    signIn: actionGeneric({
      args: {
        provider: v.optional(v.string()),
        params: v.optional(payloadRecordValidator),
        verifier: v.optional(v.string()),
        refreshToken: v.optional(v.string()),
        calledBy: v.optional(v.string()),
      },
      handler: async (ctx, args): Promise<SignInActionResult> => {
        if (args.calledBy !== undefined) {
          log("INFO", `\`auth:signIn\` called by ${args.calledBy}`);
        }
        const provider = args.provider !== undefined ? getProviderOrThrow(args.provider) : null;
        const result = await services.signIn.signIn(
          enrichCtx(ctx) as unknown as Parameters<typeof services.signIn.signIn>[0],
          provider,
          args,
          {
            generateTokens: true,
            allowExtraProviders: false,
            resolveSsoProtocol: group.resolveGroupConnectionSsoProtocolOrThrow,
          },
        );
        const resultMap: Record<string, (r: any) => SignInActionResult> = {
          redirect: (r) => ({
            kind: "redirect" as const,
            redirect: r.redirect,
            verifier: r.verifier,
          }),
          signedIn: (r) => ({
            kind: "signedIn" as const,
            tokens: r.signedIn?.tokens ?? null,
          }),
          refreshTokens: (r) => ({
            kind: "signedIn" as const,
            tokens: r.signedIn?.tokens ?? null,
          }),
          started: () => ({ kind: "started" as const }),
          passkeyOptions: (r) => ({
            kind: "passkeyOptions" as const,
            options: r.options,
            verifier: r.verifier,
          }),
          totpRequired: (r) => ({
            kind: "totpRequired" as const,
            verifier: r.verifier,
          }),
          totpSetup: (r) => ({
            kind: "totpSetup" as const,
            totpSetup: {
              uri: r.uri,
              secret: r.secret,
              totpId: r.totpId,
            },
            verifier: r.verifier,
          }),
          deviceCode: (r) => ({
            kind: "deviceCode" as const,
            deviceCode: {
              deviceCode: r.deviceCode,
              userCode: r.userCode,
              verificationUri: r.verificationUri,
              verificationUriComplete: r.verificationUriComplete,
              expiresIn: r.expiresIn,
              interval: r.interval,
            },
          }),
        };
        const handler = resultMap[result.kind];
        if (!handler) {
          throw new Error(`Unexpected sign-in result kind: ${result.kind}`);
        }
        return handler(result);
      },
    }),
    /**
     * Action called by the client to invalidate the current session.
     */
    signOut: actionGeneric({
      args: {},
      handler: async (ctx) => {
        await callSignOut(ctx);
      },
    }),

    /**
     * Internal mutation used by the library to read and write
     * to the database during signin and signout.
     */
    store: internalMutationGeneric({
      args: storeArgs,
      handler: async (ctx: MutationCtx, args) => {
        return storeImpl(ctx, args, services);
      },
    }),
  };
}
