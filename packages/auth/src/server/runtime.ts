import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  httpRouter,
  internalMutationGeneric,
} from "convex/server";
import { ConvexError, type GenericId } from "convex/values";
import type { GenericValidator, Value } from "convex/values";
import { v } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import { ErrorCode } from "../shared/codes";
import type { AuthTokens, SignInFlowResult } from "../shared/results";
import { decodeOAuthState, encodeOAuthState } from "./cookies";
import { createCoreDomains } from "./core";
import { GetProviderOrThrowFunc } from "./crypto";
import { envOptionalString, readConfigSync, requireEnv } from "./env";
import { createAuthEventDomain, emitAuthEvent } from "./events";
import {
  addAuthRoutes,
  addOAuthProviderRoutes,
  addOpenIdRoutes,
  addWellKnownRoutes,
  convertErrorsToResponse,
  createHttpAction,
  createHttpContext,
  createHttpRoute,
  getCookies,
} from "./http";
import { addMcpRoutes, type McpToolDef } from "./mcp";
import { createAuthorizeHandler } from "./oauth/authorize";
import { createClientManagementHandler } from "./oauth/manage";
import { createRegisterHandler } from "./oauth/register";
import { createTokenHandler } from "./oauth/token";
import { verifyOAuthToken } from "./tokens";
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
  vStoreArgs,
  storeImpl,
} from "./mutations/calls";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "./oauth/runtime";
import type { AuthProfile } from "./payloads";
import { vPayloadRecord } from "./payloads";
import { generateRandomString, INVITE_TOKEN_ALPHABET, sha256 } from "./random";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { extractBearerToken } from "./utils/bearer";
import { encryptSecret } from "./secret";
import { createGroupService } from "./connection/group/service";
import { resolveServerServices } from "./services/resolve";
import { createGroupConnectionDomain } from "./connection/domain";
import { addGroupHttpRuntime } from "./connection/http";
import { normalizeGroupConnectionPolicy } from "./connection/policy";
import type {
  ConvexAuthConfig,
  FunctionReferenceFromExport,
  OAuthMaterializedConfig,
  ConnectionProviderConfig,
} from "./types";
import { MutationCtx } from "./types";
import { siteUrlsFromEnv } from "./url";

const GROUP_CONNECTION_OIDC_CLIENT_SECRET_KIND = "oidc_client_secret" as const;

const vHeaderPairs = v.array(v.array(v.string()));

function formDataEntries(formData: unknown): Iterable<[string, string | { name: string }]> {
  return formData as Iterable<[string, string | { name: string }]>;
}

/**
 * Single sanctioned bridge across an irreducible cross-package ctx/domain
 * family boundary. Several runtime values are structurally equivalent at
 * runtime to a consumer's nominal type but cannot be positively unified by
 * TypeScript — e.g. the {@link enrichCtx}-enriched action ctx versus the
 * sign-in service's `GenericActionCtxWithAuthConfig`, or the assembled
 * `authBase` versus the HTTP context's `HttpContextAuthLike`. This is the one
 * narrow, typed assertion those boundaries route through; callers name the
 * exact target via the `T` type argument so the result stays precisely typed.
 */
function bridgeRuntimeType<T>(value: object): T {
  return value as T;
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
 * import { defineAuth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = defineAuth(components.auth, {
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
  const delegatableGrants: string[] = [...(config.permissions?.grants ?? [])];
  const hasOAuth = config.providers.some((provider) => provider.type === "oauth");
  const hasConnection = config.providers.some((provider) => provider.type === "connection");
  const ssoProvider = config.providers.find(
    (provider): provider is ConnectionProviderConfig => provider.type === "connection",
  );
  const getProviderOrThrow: GetProviderOrThrowFunc = services.providerRegistry.getProviderOrThrow;
  const INVITE_TOKEN_LENGTH = 48;

  const GROUP_CONNECTION_ROUTE_BASE = "/connections";
  const group = createGroupService({ config, sha256 });
  const authRequireEnv = (name: string) =>
    name === "CONVEX_SITE_URL" ? authSiteUrlFromEnv() : requireEnv(name);

  type AuthRuntimeBase = ReturnType<typeof createCoreDomains> & {
    event: ReturnType<typeof createAuthEventDomain>;
    connection: ReturnType<typeof createGroupConnectionDomain>;
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
      signInForProvider: async (ctx, providerConfig, args) => {
        const materialized =
          typeof providerConfig === "function" ? providerConfig() : providerConfig;
        const result = await services.signIn.signIn(
          bridgeRuntimeType<Parameters<typeof services.signIn.signIn>[0]>(enrichCtx(ctx)),
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
        return result as Exclude<typeof result, { kind: "signedIn" }>;
      },
    }),
    event: createAuthEventDomain(config),
    /**
     * Connection namespace — group connection management, domain, OIDC,
     * SAML, SCIM, audit, and webhook helpers.
     */
    connection: createGroupConnectionDomain({
      config,
      getGroupConnectionSecret: group.getGroupConnectionSecret,
      loadConnectionOrThrow: group.loadConnectionOrThrow,
      validateGroupConnectionPolicy: group.validateGroupConnectionPolicy,
      emitGroupAuthEvent: group.emitGroupAuthEvent,
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

  const getDefaultCorsOrigins = () => siteUrlsFromEnv().allowedUrls.map((u) => new URL(u).origin);

  const getAuthSiteUrl = (_ctx: GenericActionCtx<GenericDataModel>) => authSiteUrlFromEnv();

  const createOAuthHttpHandlers = () => ({
    handleSignIn: convertErrorsToResponse(400, async (ctx, request) => {
      const url = new URL(request.url);
      const pathParts = url.pathname.split("/");
      const providerId = pathParts[pathParts.length - 1]!;
      if (providerId === null) {
        throw convexError({
          code: ErrorCode.OAUTH_MISSING_PROVIDER,
          message: "Missing OAuth provider ID.",
        });
      }
      const verifier = url.searchParams.get("code");
      if (verifier === null) {
        throw convexError({
          code: ErrorCode.OAUTH_MISSING_VERIFIER,
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
    handleCallback: async (ctx: GenericActionCtx<GenericDataModel>, request: Request) => {
      const url = new URL(request.url);
      const callbackPathParts = new URL(request.url).pathname.split("/");
      const providerId = callbackPathParts[callbackPathParts.length - 1];
      if (!providerId) {
        throw convexError({
          code: ErrorCode.OAUTH_MISSING_PROVIDER,
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

  const createProtocolRouter = (authSiteUrl: string) => {
    const protocolHttp = createInMemoryHttpRouter();
    const protocolRequireEnv = (name: string) =>
      name === "CONVEX_SITE_URL" ? authSiteUrl : requireEnv(name);

    addOpenIdRoutes(protocolHttp as HttpRouter, {
      getIssuer: () => authSiteUrl,
      getJwks: () => requireEnv("JWKS"),
    });

    addWellKnownRoutes(protocolHttp as HttpRouter, {
      getResponse: (endpoint) => wellKnown(endpoint),
    });

    addGroupHttpRuntime({
      http: protocolHttp as HttpRouter,
      hasConnection,
      auth: authBase as Parameters<typeof addGroupHttpRuntime>[0]["auth"],
      config,
      routeBase: "/connections",
      requireEnv: protocolRequireEnv,
      loadActiveConnectionSamlOrThrow: group.loadActiveConnectionSamlOrThrow,
      loadConnectionOidcOrThrow: group.loadConnectionOidcOrThrow,
      getGroupConnectionScimContext: group.getGroupConnectionScimContext,
      loadGroupPolicyOrThrow: group.loadGroupPolicyOrThrow,
      normalizeGroupConnectionPolicy,
      emitGroupAuthEvent: group.emitGroupAuthEvent,
      generateRandomString,
      inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
      callUserOAuth,
      callVerifierSignature,
      sharedOidcRedirectURI: ssoProvider?.redirectURI,
    });

    if (hasOAuth) {
      addAuthRoutes(protocolHttp as HttpRouter, {
        routeBase: "",
        ...createOAuthHttpHandlers(),
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
        oauth: config.oauth ? { scopes: delegatableGrants } : undefined,
      });

      addWellKnownRoutes(http, {
        getResponse: (endpoint) => wellKnown(endpoint),
      });

      addGroupHttpRuntime({
        http,
        hasConnection,
        auth: authBase as Parameters<typeof addGroupHttpRuntime>[0]["auth"],
        config,
        routeBase: `${routePrefix}${GROUP_CONNECTION_ROUTE_BASE}`,
        requireEnv: protocolRequireEnv,
        loadActiveConnectionSamlOrThrow: group.loadActiveConnectionSamlOrThrow,
        loadConnectionOidcOrThrow: group.loadConnectionOidcOrThrow,
        getGroupConnectionScimContext: group.getGroupConnectionScimContext,
        loadGroupPolicyOrThrow: group.loadGroupPolicyOrThrow,
        normalizeGroupConnectionPolicy,
        emitGroupAuthEvent: group.emitGroupAuthEvent,
        generateRandomString,
        inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
        callUserOAuth,
        callVerifierSignature,
        sharedOidcRedirectURI: ssoProvider?.redirectURI,
      });

      if (config.oauth) {
        addOAuthProviderRoutes(http, {
          routeBase: routePrefix,
          handleAuthorize: createAuthorizeHandler({
            getClient: (ctx, clientId) => authBase.oauth.client.get(ctx, { clientId }),
            consentPage: config.oauth.pages.consent,
            authSiteUrl,
          }),
          handleToken: createTokenHandler({
            getClient: (ctx, clientId) => authBase.oauth.client.get(ctx, { clientId }),
            verifyClientSecret: (ctx, clientId, clientSecret) =>
              authBase.oauth.client.verify(ctx, { clientId, clientSecret }),
            acceptCode: (ctx, codeHash, clientId, redirectUri, codeChallenge) =>
              authBase.oauth.code.accept(ctx, { codeHash, clientId, redirectUri, codeChallenge }),
            createRefresh: (ctx, args) => authBase.oauth.refresh.create(ctx, args),
            exchangeRefresh: (ctx, args) => authBase.oauth.refresh.exchange(ctx, args),
            emitEvent: async (ctx, event) => await emitAuthEvent(ctx, config, event),
          }),
          handleRegister: createRegisterHandler({
            createClient: (ctx, opts) =>
              authBase.oauth.client.create(ctx, { data: { ...opts, extend: { kind: "dcr" } } }),
            allowedScopes: delegatableGrants,
            registrationClientUri: (clientId) => `${authSiteUrl()}/oauth2/register/${clientId}`,
          }),
          handleManage: createClientManagementHandler({
            verifyRegistrationToken: (ctx, args) =>
              authBase.oauth.client.verifyRegistrationToken(ctx, args),
            update: (ctx, args) => authBase.oauth.client.update(ctx, args),
            revoke: (ctx, args) => authBase.oauth.client.revoke(ctx, args),
            allowedScopes: delegatableGrants,
            registrationClientUri: (clientId) => `${authSiteUrl()}/oauth2/register/${clientId}`,
          }),
        });

      }

      if (hasOAuth) {
        addAuthRoutes(http, {
          routeBase: routePrefix,
          ...createOAuthHttpHandlers(),
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
     * Use `auth.request.context.optional(ctx, request)` to get a null-shaped
     * auth object instead of a `NOT_SIGNED_IN` error.
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
    context: createHttpContext(bridgeRuntimeType<Parameters<typeof createHttpContext>[0]>(authBase)),

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
      authBase as Parameters<typeof createHttpAction>[0],
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
        authBase as Parameters<typeof createHttpAction>[0],
        getDefaultCorsOrigins,
      ),
      getDefaultCorsOrigins,
    ),

    /**
     * Mount a remote MCP server (an OAuth-protected resource server) on `http`,
     * next to the other HTTP registrars (`add`, `route`). Requires `oauth` to be
     * configured in `defineAuth` — the MCP server shares the AS `scopes` and
     * bearer-token verification — and throws at registration time otherwise.
     * Tools are plain `{ description, scope, args, handler }` objects; each
     * handler's `args` are inferred from its Convex validator.
     */
    mcp: (
      http: HttpRouter,
      tools: Record<string, McpToolDef>,
      opts?: { name?: string; version?: string; mcpPath?: string },
    ): void => {
      if (config.oauth === undefined) {
        throw new Error(
          "`auth.request.mcp(...)` requires `oauth` to be configured in `defineAuth` — the MCP server is protected by the OAuth authorization server.",
        );
      }
      if (delegatableGrants.length === 0) {
        throw new Error(
          "`auth.request.mcp(...)` requires `permissions` with at least one grant — MCP tools delegate your app's grants, and none are defined.",
        );
      }
      const mcpPath = opts?.mcpPath ?? "/mcp";
      const canonicalResource = () => requireEnv("CONVEX_SITE_URL").replace(/\/+$/, "") + mcpPath;
      addMcpRoutes(http, {
        tools,
        name: opts?.name,
        version: opts?.version,
        scopes: delegatableGrants,
        mcpPath,
        resource: canonicalResource,
        authorizationServers: () => [authSiteUrlFromEnv()],
        resolveScopes: async (_ctx, request) => {
          const token = extractBearerToken(request);
          if (token === null) return null;
          const verified = await verifyOAuthToken(token, { resource: canonicalResource() });
          return verified ? verified.scopes : null;
        },
      });
    },
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

  const accountUnlink = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { accountId: GenericId<"Account"> },
  ) => {
    const accountDoc = (await ctx.runQuery(config.component.account.get, {
      id: args.accountId,
    })) as { _id: string; userId: string; provider: string } | null;
    if (accountDoc === null) {
      throw convexError({
        code: ErrorCode.ACCOUNT_NOT_FOUND,
        message: "Account not found.",
      });
    }
    await ctx.runMutation(config.component.account.remove, {
      id: args.accountId,
    });
    const userId = accountDoc.userId as GenericId<"User">;
    const provider = accountDoc.provider;
    await emitAuthEvent(ctx, config, {
      kind: "account.unlinked",
      actor: { type: "user", id: userId },
      subject: { type: "account", id: args.accountId },
      targets: [{ kind: "user", id: userId }],
      outcome: "success",
      data: {
        accountId: args.accountId,
        provider,
      },
    });
    return { accountId: args.accountId, userId, provider };
  };

  const passkeyDelete = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { passkeyId: GenericId<"Passkey"> },
  ) => {
    const passkeyDoc = (await ctx.runQuery(config.component.factor.passkey.get, {
      id: args.passkeyId,
    })) as { _id: string; userId: string } | null;
    if (passkeyDoc === null) {
      throw convexError({
        code: ErrorCode.PASSKEY_NOT_FOUND,
        message: "Passkey not found.",
      });
    }
    await ctx.runMutation(config.component.factor.passkey.remove, {
      id: args.passkeyId,
    });
    const userId = passkeyDoc.userId as GenericId<"User">;
    await emitAuthEvent(ctx, config, {
      kind: "passkey.removed",
      actor: { type: "user", id: userId },
      subject: { type: "passkey", id: args.passkeyId },
      targets: [{ kind: "user", id: userId }],
      outcome: "success",
      data: { passkeyId: args.passkeyId },
    });
    return { passkeyId: args.passkeyId, userId };
  };

  const totpDelete = async (
    ctx: GenericActionCtx<GenericDataModel>,
    args: { totpId: GenericId<"TotpFactor"> },
  ) => {
    const totpDoc = (await ctx.runQuery(config.component.factor.totp.get, {
      id: args.totpId,
    })) as { _id: string; userId: string } | null;
    if (totpDoc === null) {
      throw convexError({
        code: ErrorCode.TOTP_NOT_FOUND,
        message: "TOTP factor not found.",
      });
    }
    await ctx.runMutation(config.component.factor.totp.remove, {
      id: args.totpId,
    });
    const userId = totpDoc.userId as GenericId<"User">;
    await emitAuthEvent(ctx, config, {
      kind: "totp.removed",
      actor: { type: "user", id: userId },
      subject: { type: "totp", id: args.totpId },
      targets: [{ kind: "user", id: userId }],
      outcome: "success",
      data: { totpId: args.totpId },
    });
    return { totpId: args.totpId, userId };
  };

  const enrichedAccount = Object.assign({}, auth.account, { unlink: accountUnlink });
  const passkeyHelpers = { remove: passkeyDelete };
  const totpHelpers = { remove: totpDelete };

  const enrichCtx = <DataModel extends GenericDataModel>(ctx: GenericActionCtx<DataModel>) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      getUserIdentity: ctx.auth.getUserIdentity.bind(ctx.auth),
      config,
      account: enrichedAccount,
      passkey: passkeyHelpers,
      totp: totpHelpers,
      session: auth.session,
      member: auth.member,
      provider: auth.provider,
      event: auth.event,
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
        params: v.optional(vPayloadRecord),
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
          provider?.type === "oauth" || provider?.type === "connection" ? getAuthSiteUrl(ctx) : undefined;
        const result = await services.signIn.signIn(
          bridgeRuntimeType<Parameters<typeof services.signIn.signIn>[0]>(enrichCtx(ctx)),
          provider,
          args,
          {
            generateTokens: true,
            allowExtraProviders: false,
            authSiteUrl,
            resolveConnectionProtocol: group.resolveGroupConnectionConnectionProtocolOrThrow,
          },
        );
        const resultKind: string = result.kind;
        /** Exhaustive narrowing dispatch: only `signedIn` reshapes its session into tokens; every other variant passes through unchanged. */
        switch (result.kind) {
          case "signedIn":
            return {
              kind: "signedIn",
              session: result.session?.tokens ?? null,
            };
          case "redirect":
          case "started":
          case "passkeyOptions":
          case "totpRequired":
          case "totpSetup":
          case "deviceCode":
            return result;
          default:
            throw new Error(`Unexpected sign-in result kind: ${resultKind}`);
        }
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
      args: vStoreArgs,
      handler: async (ctx: MutationCtx, args) => {
        return storeImpl(ctx, args, services);
      },
    }),

    /** App-side HTTP protocol delegate retained for generated API compatibility. */
    http,
  };
}
