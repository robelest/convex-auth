import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  httpRouter,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError, type GenericId } from "convex/values";
import type { Value } from "convex/values";
import { v } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import type { AuthTokens, SignInFlowResult } from "../shared/results";
import { decodeOAuthState, encodeOAuthState } from "./cookies";
import { createCoreDomains } from "./core";
import { GetProviderOrThrowFunc } from "./crypto";
import { envOptionalString, readConfigSync, requireEnv } from "./env";
import { FlowSignal } from "./errors";
import {
  addAuthRoutes,
  addOpenIdRoutes,
  addWellKnownRoutes,
  convertErrorsToResponse,
  createHttpAction,
  createHttpContext,
  createHttpRoute,
  getCookies,
} from "./http";
import { wellKnown } from "./wellknown";
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
} from "./types";
import { MutationCtx } from "./types";
import { siteUrlsFromEnv } from "./url";

const GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND = "oidc_client_secret" as const;

const vHeaderPairs = v.array(v.array(v.string()));

function formDataEntries(formData: unknown): Iterable<[string, string | { name: string }]> {
  return formData as unknown as Iterable<[string, string | { name: string }]>;
}

const vHttpDelegateResponse = v.object({
  status: v.number(),
  statusText: v.string(),
  headers: vHeaderPairs,
  body: v.string(),
});

type HttpDelegateResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
};

type HttpRouteSpec = {
  path?: string;
  pathPrefix?: string;
  method: string;
  handler: unknown;
};

type AuthHttpRouteOptions = {
  /** Prefix where auth HTTP routes are mounted, e.g. `/auth`. */
  prefix?: string;
};

function normalizeRoutePrefix(prefix: string | undefined) {
  if (prefix === undefined || prefix === "" || prefix === "/") {
    return "";
  }
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/$/, "");
}

function appendRoutePrefix(siteUrl: string, prefix: string) {
  return `${siteUrl.replace(/\/$/, "")}${prefix}`;
}

function authSiteUrlFromEnv() {
  const siteUrl =
    readConfigSync(envOptionalString("CONVEX_AUTH_SITE_URL")) ?? requireEnv("CONVEX_SITE_URL");
  const prefix = normalizeRoutePrefix(
    readConfigSync(envOptionalString("CONVEX_AUTH_HTTP_PREFIX")) ?? "/auth",
  );
  return appendRoutePrefix(siteUrl, prefix);
}

function createInMemoryHttpRouter() {
  const routes: HttpRouteSpec[] = [];
  return {
    route: (spec: HttpRouteSpec) => {
      routes.push(spec);
    },
    lookup(pathname: string, method: string): HttpRouteSpec | null {
      const exact = routes.find((route) => route.method === method && route.path === pathname);
      if (exact) {
        return exact;
      }
      return (
        routes
          .filter(
            (route) =>
              route.method === method &&
              route.pathPrefix !== undefined &&
              pathname.startsWith(route.pathPrefix),
          )
          .sort((a, b) => (b.pathPrefix?.length ?? 0) - (a.pathPrefix?.length ?? 0))[0] ?? null
      );
    },
  };
}

async function invokeHttpHandler(
  handler: unknown,
  ctx: GenericActionCtx<GenericDataModel>,
  request: Request,
): Promise<Response> {
  const maybeHandler = handler as {
    _handler?: (ctx: GenericActionCtx<GenericDataModel>, request: Request) => Promise<Response>;
  };
  if (typeof maybeHandler._handler === "function") {
    return await maybeHandler._handler(ctx, request);
  }
  throw new Error("Invalid HTTP action handler.");
}

async function serializeHttpResponse(response: Response): Promise<HttpDelegateResponse> {
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  const setCookies = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  if (setCookies !== undefined) {
    for (const cookie of setCookies) {
      headers.push(["set-cookie", cookie]);
    }
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.text(),
  };
}

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
export type SignInActionResult = SignInFlowResult<AuthTokens | null>;
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
 * export const signIn = auth.signIn;
 * export const signOut = auth.signOut;
 * export const store = auth.store;
 * export const http = auth.http;
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

  const GROUP_CONNECTION_ROUTE_BASE = "/connections";
  const group = createGroupService({ config, sha256 });
  const authRequireEnv = (name: string) =>
    name === "CONVEX_SITE_URL" ? authSiteUrlFromEnv() : requireEnv(name);

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
      // Wire `auth.provider.signIn` through the canonical sign-in service so
      // credential providers (e.g. password.ts) can re-enter the flow with a
      // different provider config (verify/reset OTP issuance, OAuth redirect,
      // device flow).
      //
      // Non-`signedIn` flow results (e.g. `started` after sending an OTP
      // email) are surfaced via a thrown {@link FlowSignal} so the outer
      // signIn action receives the original `{ kind: "started" }` shape
      // rather than collapsing through the credentials authorize → handler
      // mapping (which only knows about `signedIn` and `totpRequired`).
      signInForProvider: async (ctx, providerConfig, args) => {
        const materialized =
          typeof providerConfig === "function" ? providerConfig() : providerConfig;
        const result = await services.signIn.signIn(
          enrichCtx(ctx) as unknown as Parameters<typeof services.signIn.signIn>[0],
          materialized as Parameters<typeof services.signIn.signIn>[1],
          args,
          {
            generateTokens: false,
            allowExtraProviders: true,
          },
        );
        if (result.kind === "signedIn") {
          const session = result.session as {
            userId?: string;
            sessionId?: string;
            _id?: string;
          } | null;
          if (session === null || session === undefined) {
            return null;
          }
          const userId = session.userId;
          const sessionId = session.sessionId ?? session._id;
          if (userId === undefined || sessionId === undefined) {
            return null;
          }
          return { userId, sessionId };
        }
        // Bubble the non-signedIn result up to the action handler. The
        // credentials runner unwraps `FlowSignal` and re-emits the carried
        // result so e.g. `{ kind: "started" }` reaches the client unchanged.
        throw new FlowSignal(result as { kind: string; [key: string]: unknown });
      },
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
      requireEnv: authRequireEnv,
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

  const getAuthSiteUrl = (_ctx: GenericActionCtx<GenericDataModel>) => authSiteUrlFromEnv();

  const createProtocolRouter = (authSiteUrl: string) => {
    const protocolHttp = createInMemoryHttpRouter();
    const protocolRequireEnv = (name: string) =>
      name === "CONVEX_SITE_URL" ? authSiteUrl : requireEnv(name);

    addOpenIdRoutes(protocolHttp as unknown as HttpRouter, {
      getIssuer: () => authSiteUrl,
      getJwks: () => requireEnv("JWKS"),
    });

    addWellKnownRoutes(protocolHttp as unknown as HttpRouter, {
      getResponse: (endpoint) => wellKnown(endpoint),
    });

    addGroupHttpRuntime({
      http: protocolHttp as unknown as HttpRouter,
      hasSSO,
      auth: authBase as unknown as Parameters<typeof addGroupHttpRuntime>[0]["auth"],
      config,
      routeBase: "/connections",
      requireEnv: protocolRequireEnv,
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
      addAuthRoutes(protocolHttp as unknown as HttpRouter, {
        routeBase: "",
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
          const redirectTo = url.searchParams.get("redirectTo");
          const { redirect, cookies, signature } = await createOAuthAuthorizationURL(
            providerId,
            oauthConfig,
            {
              stateTransform: (state) => encodeOAuthState(state, redirectTo),
            },
          );

          await callVerifierSignature(ctx, {
            verifier,
            signature,
          });

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

          const params = url.searchParams;

          if (request.headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")) {
            const formData = await request.formData();
            for (const [key, value] of formDataEntries(formData)) {
              if (typeof value === "string") {
                params.append(key, value);
              }
            }
          }

          const fallbackDestinationUrl = await redirectAbsoluteUrl(ctx, config, {
            redirectTo: undefined,
          });

          try {
            const oauthConfig = provider as OAuthMaterializedConfig;
            const result = await handleOAuthCallback(
              providerId,
              oauthConfig,
              Object.fromEntries(params.entries()),
              cookies,
            );
            const oauthCookies = result.cookies;
            const { id: profileId, emails: profileEmails, ...profileData } = result.profile;
            const { signature } = result;
            const { redirectTo: stateRedirectTo } = decodeOAuthState(params.get("state") ?? "");
            const destinationUrl = await redirectAbsoluteUrl(ctx, config, {
              redirectTo: stateRedirectTo ?? undefined,
            });

            const verificationCode = await callUserOAuth(ctx, {
              provider: providerId,
              providerAccountId: profileId,
              profile: profileData as AuthProfile,
              emails: profileEmails,
              signature,
            });

            const redirUrl = setURLSearchParam(destinationUrl, "code", verificationCode);
            const redirHeaders = new Headers({ Location: redirUrl });
            redirHeaders.set("Cache-Control", "must-revalidate");
            for (const { name, value, options } of oauthCookies as Array<{
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
            return new Response(null, {
              status: 302,
              headers: { Location: fallbackDestinationUrl },
            });
          }
        },
      });
    }

    return protocolHttp;
  };

  const request = {
    /**
     * Register core HTTP routes for JWT verification and OAuth sign-in.
     *
     * ```ts
     * import { httpRouter } from "convex/server";
     * import { auth } from "./auth";
     *
     * export default auth.http();
     * ```
     *
     * The following routes are handled always:
     *
     * - `/.well-known/apple-app-site-association`
     * - `/.well-known/assetlinks.json`
     * - `/.well-known/webauthn`
     * - `/.well-known/change-password`
     * - `/.well-known/security.txt`
     * - `<prefix>/.well-known/openid-configuration`
     * - `<prefix>/.well-known/jwks.json`
     *
     * The following routes are handled if OAuth is configured:
     *
     * - `/signin/*`
     * - `/callback/*`
     *
     * @param http your HTTP router
     * @param options.prefix where to mount auth protocol routes, e.g. `/auth`
     */
    add: (http: HttpRouter, options?: AuthHttpRouteOptions) => {
      const routePrefix = normalizeRoutePrefix(options?.prefix);
      const authSiteUrl = () => appendRoutePrefix(requireEnv("CONVEX_SITE_URL"), routePrefix);
      const protocolRequireEnv = (name: string) =>
        name === "CONVEX_SITE_URL" ? authSiteUrl() : requireEnv(name);

      addOpenIdRoutes(http, {
        routeBase: routePrefix,
        getIssuer: authSiteUrl,
        getJwks: () => requireEnv("JWKS"),
      });

      addWellKnownRoutes(http, {
        getResponse: (endpoint) => wellKnown(endpoint),
      });

      addGroupHttpRuntime({
        http,
        hasSSO,
        auth: authBase as unknown as Parameters<typeof addGroupHttpRuntime>[0]["auth"],
        config,
        routeBase: `${routePrefix}${GROUP_CONNECTION_ROUTE_BASE}`,
        requireEnv: protocolRequireEnv,
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
          routeBase: routePrefix,
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
            const redirectTo = url.searchParams.get("redirectTo");
            const { redirect, cookies, signature } = await createOAuthAuthorizationURL(
              providerId,
              oauthConfig,
              {
                stateTransform: (state) => encodeOAuthState(state, redirectTo),
              },
            );

            await callVerifierSignature(ctx, {
              verifier,
              signature,
            });

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

            const params = url.searchParams;

            if (
              request.headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")
            ) {
              const formData = await request.formData();
              for (const [key, value] of formDataEntries(formData)) {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              }
            }

            const fallbackDestinationUrl = await redirectAbsoluteUrl(ctx, config, {
              redirectTo: undefined,
            });

            try {
              const oauthConfig = provider as OAuthMaterializedConfig;
              const result = await handleOAuthCallback(
                providerId,
                oauthConfig,
                Object.fromEntries(params.entries()),
                cookies,
              );
              const oauthCookies = result.cookies;
              const { id: profileId, emails: profileEmails, ...profileData } = result.profile;
              const { signature } = result;
              const { redirectTo: stateRedirectTo } = decodeOAuthState(params.get("state") ?? "");
              const destinationUrl = await redirectAbsoluteUrl(ctx, config, {
                redirectTo: stateRedirectTo ?? undefined,
              });

              const verificationCode = await callUserOAuth(ctx, {
                provider: providerId,
                providerAccountId: profileId,
                profile: profileData as AuthProfile,
                emails: profileEmails,
                signature,
              });

              const redirUrl = setURLSearchParam(destinationUrl, "code", verificationCode);
              const redirHeaders = new Headers({ Location: redirUrl });
              redirHeaders.set("Cache-Control", "must-revalidate");
              for (const { name, value, options } of oauthCookies as Array<{
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
              return new Response(null, {
                status: 302,
                headers: { Location: fallbackDestinationUrl },
              });
            }
          },
        });
      }
    },

    /**
     * Create a Convex HTTP router with auth protocol routes already mounted.
     *
     * Defaults to the `/auth` prefix. Use {@link request.add add} instead when
     * you need to compose auth routes with app-specific HTTP routes in the same
     * router.
     *
     * ```ts
     * import { auth } from "./auth";
     *
     * export default auth.http();
     * ```
     */
    router: (options?: AuthHttpRouteOptions) => {
      const http = httpRouter();
      request.add(http, options ?? { prefix: "/auth" });
      return http;
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
     *     const authContext = await auth.request.context(ctx, request);
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
     * const handler = auth.request.action(async (ctx, request) => {
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
     * auth.request.route(http, {
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

  const auth = Object.assign(authBase, { request });

  const httpDelegate = actionGeneric({
    args: {
      authSiteUrl: v.string(),
      routePath: v.string(),
      url: v.string(),
      method: v.string(),
      headers: vHeaderPairs,
      body: v.optional(v.string()),
    },
    returns: vHttpDelegateResponse,
    handler: async (ctx, args): Promise<HttpDelegateResponse> => {
      const incomingUrl = new URL(args.url);
      const requestUrl = new URL(args.authSiteUrl.replace(/\/$/, "") + args.routePath);
      requestUrl.search = incomingUrl.search;
      const method = args.method.toUpperCase();
      const request = new Request(requestUrl, {
        method,
        headers: new Headers(args.headers as Array<[string, string]>),
        body: method === "GET" || method === "HEAD" ? undefined : (args.body ?? ""),
      });

      const protocolHttp = createProtocolRouter(args.authSiteUrl.replace(/\/$/, ""));
      const route = protocolHttp.lookup(args.routePath, method);
      if (!route) {
        return await serializeHttpResponse(new Response(null, { status: 404 }));
      }

      const response = await invokeHttpHandler(route.handler, ctx, request);
      return await serializeHttpResponse(response);
    },
  });
  const http = Object.assign(
    (options?: AuthHttpRouteOptions) => request.router(options),
    httpDelegate,
  );

  // ---------------------------------------------------------------------------
  // Lifecycle-aware deletion helpers exposed on `ctx.auth.{account,passkey,totp}`.
  //
  // Each helper reads the target doc first (to capture identifying fields like
  // `userId` / `provider` before deletion), runs the corresponding component
  // mutation, then fires the matching `after` lifecycle event so callbacks
  // observe the change atomically with the mutation that performed it.
  // ---------------------------------------------------------------------------
  const accountUnlink = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { accountId: GenericId<"Account"> },
  ) => {
    const accountDoc = (await ctx.runQuery(config.component.public.accountGetById, {
      accountId: args.accountId,
    })) as { _id: string; userId: string; provider: string } | null;
    if (accountDoc === null) {
      throw convexError({
        code: "ACCOUNT_NOT_FOUND",
        message: "Account not found.",
      });
    }
    await ctx.runMutation(config.component.public.accountDelete, {
      accountId: args.accountId,
    });
    const userId = accountDoc.userId as GenericId<"User">;
    const provider = accountDoc.provider;
    await config.callbacks?.after?.(ctx, {
      kind: "accountUnlinked",
      userId,
      accountId: args.accountId,
      provider,
    });
    return { accountId: args.accountId, userId, provider };
  };

  const passkeyDelete = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { passkeyId: GenericId<"Passkey"> },
  ) => {
    const passkeyDoc = (await ctx.runQuery(config.component.public.passkeyGetById, {
      passkeyId: args.passkeyId,
    })) as { _id: string; userId: string } | null;
    if (passkeyDoc === null) {
      throw convexError({
        code: "PASSKEY_NOT_FOUND",
        message: "Passkey not found.",
      });
    }
    await ctx.runMutation(config.component.public.passkeyDelete, {
      passkeyId: args.passkeyId,
    });
    const userId = passkeyDoc.userId as GenericId<"User">;
    await config.callbacks?.after?.(ctx, {
      kind: "passkeyRemoved",
      userId,
      passkeyId: args.passkeyId,
    });
    return { passkeyId: args.passkeyId, userId };
  };

  const totpDelete = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { totpId: GenericId<"TotpFactor"> },
  ) => {
    const totpDoc = (await ctx.runQuery(config.component.public.totpGetById, {
      totpId: args.totpId,
    })) as { _id: string; userId: string } | null;
    if (totpDoc === null) {
      throw convexError({
        code: "TOTP_NOT_FOUND",
        message: "TOTP factor not found.",
      });
    }
    // The component mutation atomically clears `User.hasTotp` when no other
    // verified factors remain, so callers do not need to coordinate that flag.
    await ctx.runMutation(config.component.public.totpDelete, {
      totpId: args.totpId,
    });
    const userId = totpDoc.userId as GenericId<"User">;
    await config.callbacks?.after?.(ctx, {
      kind: "totpRemoved",
      userId,
      totpId: args.totpId,
    });
    return { totpId: args.totpId, userId };
  };

  const enrichedAccount = Object.assign({}, auth.account, { unlink: accountUnlink });
  const passkeyHelpers = { delete: passkeyDelete };
  const totpHelpers = { delete: totpDelete };

  const enrichCtx = <DataModel extends GenericDataModel>(ctx: GenericActionCtx<DataModel>) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      // Methods on `ctx.auth` may live on the class prototype — spread only
      // copies own enumerable properties, so re-bind the ones we know we'll
      // need from inside provider authorize callbacks.
      getUserIdentity: ctx.auth.getUserIdentity.bind(ctx.auth),
      config,
      account: enrichedAccount,
      passkey: passkeyHelpers,
      totp: totpHelpers,
      session: auth.session,
      member: auth.member,
      provider: auth.provider,
    },
  });

  return {
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
        const authSiteUrl =
          provider?.type === "oauth" || provider?.type === "sso" ? getAuthSiteUrl(ctx) : undefined;
        const result = await services.signIn.signIn(
          enrichCtx(ctx) as unknown as Parameters<typeof services.signIn.signIn>[0],
          provider,
          args,
          {
            generateTokens: true,
            allowExtraProviders: false,
            authSiteUrl,
            resolveSsoProtocol: group.resolveGroupConnectionSsoProtocolOrThrow,
          },
        );
        const resultMap: Record<string, (r: any) => SignInActionResult> = {
          redirect: (r) => r,
          signedIn: (r) => ({
            kind: "signedIn" as const,
            session: r.session?.tokens ?? null,
          }),
          started: (r) => r,
          passkeyOptions: (r) => r,
          totpRequired: (r) => r,
          totpSetup: (r) => r,
          deviceCode: (r) => r,
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

    /** App-side HTTP protocol delegate retained for generated API compatibility. */
    http,
  };
}
