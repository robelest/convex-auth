import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  UserIdentity,
  httpActionGeneric,
} from "convex/server";
import { ConvexError } from "convex/values";
import { parse as parseCookies } from "cookie";
import { Cause, Effect, Exit } from "effect";

import type {
  AuthContext,
  OptionalAuthContext,
  UserDoc,
} from "./auth";
import {
  createUnauthenticatedAuthContext,
  getAuthContextForUser,
  getSessionUserId,
} from "./context";
import type { CorsConfig, HttpKeyContext } from "./types";
import { logError } from "./log";

type HttpQueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type HttpIdentityCtx = {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
};
type HttpContextCtx = HttpIdentityCtx & HttpQueryCtx;

type HttpContextAuthLike = {
  user: {
    get: (ctx: HttpQueryCtx, userId: string) => Promise<UserDoc>;
    getActiveGroup: (ctx: HttpQueryCtx, args: { userId: string }) => Promise<string | null>;
  };
  member: {
    inspect: (
      ctx: HttpQueryCtx,
      args: { userId: string; groupId: string },
    ) => Promise<{
      membership: unknown;
      roleIds: string[];
      grants: string[];
    }>;
  };
  key: {
    verify: (ctx: GenericActionCtx<GenericDataModel>, rawKey: string) => Promise<{
      userId: string;
      keyId: string;
      scopes: HttpKeyContext["key"]["scopes"];
    }>;
  };
};

/**
 * Auth context returned by `auth.http.context(ctx, request)`.
 *
 * This resolves raw HTTP authentication in two steps:
 * 1. session auth from `ctx.auth.getUserIdentity()`
 * 2. API key auth from `Authorization: Bearer sk_*`
 *
 * The `source` field tells you which authentication path succeeded.
 * When `source === "key"`, the verified API key metadata is available on
 * `key`.
 *
 * @example
 * ```ts
 * const authContext = await auth.http.context(ctx, request);
 * if (authContext.source === "key") {
 *   console.log(authContext.key.keyId);
 * }
 * ```
 */
export type HttpAuthContext =
  | (AuthContext & {
      /** The request authenticated through a browser or session token. */
      source: "session";
      /** No API key was used for this request. */
      key: null;
    })
  | (AuthContext & {
      /** The request authenticated through an API key. */
      source: "key";
      /** Verified API key metadata for the request. */
      key: HttpKeyContext["key"];
    });

/**
 * Nullable HTTP auth context returned by
 * `auth.http.context(ctx, request, { optional: true })`.
 *
 * This preserves a stable auth-shaped object for raw `httpAction` handlers
 * that allow anonymous callers.
 */
export type OptionalHttpAuthContext =
  | (OptionalAuthContext & {
      /** No authentication source was resolved. */
      source: null;
      /** No API key metadata is available. */
      key: null;
    })
  | HttpAuthContext;

/**
 * Configuration for {@link createAuth().http.context}.
 *
 * This mirrors {@link AuthContextConfig} for raw HTTP handlers and adds support
 * for enriching mixed session/API-key auth results.
 *
 * @typeParam TResolve - Extra fields returned from `resolve()` and merged into
 *   the resolved HTTP auth context.
 *
 * @example
 * ```ts
 * const authContext = await auth.http.context(ctx, request, {
 *   resolve: async (_ctx, user, authState) => ({
 *     email: user.email,
 *     isMachineRequest: authState.source === "key",
 *   }),
 * });
 * ```
 */
export type HttpAuthContextConfig<
  TResolve extends Record<string, unknown> = Record<string, never>,
  TCtx extends HttpContextCtx = HttpContextCtx,
> = {
  /**
   * Allow unauthenticated callers and return a null-shaped auth object instead
   * of throwing `NOT_SIGNED_IN`.
   */
  optional?: boolean;
  /**
   * Attach additional derived fields to the resolved HTTP auth context.
   *
   * This callback runs only when authentication succeeds.
   */
  resolve?: (
    ctx: TCtx,
    user: UserDoc,
    auth: HttpAuthContext,
  ) => Promise<TResolve> | TResolve;
  /**
   * Override or wrap HTTP auth resolution.
   *
   * Return `undefined` to use the built-in session-or-key resolver, `null` for
   * an explicit unauthenticated state, or a fully resolved
   * {@link HttpAuthContext}.
   */
  authResolve?: (
    ctx: TCtx,
    fallback: () => Promise<HttpAuthContext | null>,
  ) =>
    | Promise<HttpAuthContext | null | undefined>
    | HttpAuthContext
    | null
    | undefined;
};

function createNotSignedInError() {
  return new ConvexError({
    code: "NOT_SIGNED_IN",
    message: "Authentication required.",
  });
}

/**
 * Build CORS headers by matching the request's Origin against allowed origins.
 * Defaults to `defaultOrigins` (site URLs) when no per-route config is given.
 */
function buildCorsHeaders(
  request: Request,
  corsConfig: CorsConfig | undefined,
  defaultOrigins: string[] | (() => string[]),
): Record<string, string> {
  const origins =
    corsConfig?.origins ??
    (typeof defaultOrigins === "function" ? defaultOrigins() : defaultOrigins);
  const requestOrigin = request.headers.get("Origin");
  const matchedOrigin = origins.includes("*")
    ? "*"
    : requestOrigin && origins.includes(requestOrigin)
      ? requestOrigin
      : null;

  return {
    ...(matchedOrigin
      ? { "Access-Control-Allow-Origin": matchedOrigin }
      : {}),
    "Access-Control-Allow-Methods":
      corsConfig?.methods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      corsConfig?.headers ?? "Content-Type,Authorization",
  };
}

function runBoundary<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromiseExit(effect).then(
    Exit.match({
      onSuccess: (value) => value,
      onFailure: (cause) => Promise.reject(Cause.squash(cause)),
    }),
  );
}

async function getHttpKeyContext(
  auth: HttpContextAuthLike,
  ctx: HttpContextCtx,
  request: Request,
): Promise<HttpAuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer sk_")) {
    return null;
  }

  try {
    const verified = await auth.key.verify(
      ctx as GenericActionCtx<GenericDataModel>,
      authHeader.slice(7),
    );
    const authContext = await getAuthContextForUser(auth, ctx, verified.userId);
    return {
      ...authContext,
      source: "key",
      key: {
        userId: verified.userId,
        keyId: verified.keyId,
        scopes: verified.scopes,
      },
    };
  } catch {
    return null;
  }
}

async function resolveHttpAuthContext(
  auth: HttpContextAuthLike,
  ctx: HttpContextCtx,
  request: Request,
): Promise<HttpAuthContext | null> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer sk_")) {
    const keyContext = await getHttpKeyContext(auth, ctx, request);
    if (keyContext !== null) {
      return keyContext;
    }
  }

  const sessionUserId = await getSessionUserId(ctx);
  if (sessionUserId !== null) {
    const authContext = await getAuthContextForUser(auth, ctx, sessionUserId);
    return {
      ...authContext,
      source: "session",
      key: null,
    };
  }

  return await getHttpKeyContext(auth, ctx, request);
}

/**
 * @internal
 * Create the implementation behind `auth.http.context(...)`.
 */
export function createHttpContext(auth: HttpContextAuthLike): {
  <
    TResolve extends Record<string, unknown> = Record<string, never>,
    TCtx extends HttpContextCtx = HttpContextCtx,
  >(
    ctx: TCtx,
    request: Request,
    config: HttpAuthContextConfig<TResolve, TCtx> & { optional: true },
  ): Promise<OptionalHttpAuthContext & TResolve>;
  <
    TResolve extends Record<string, unknown> = Record<string, never>,
    TCtx extends HttpContextCtx = HttpContextCtx,
  >(
    ctx: TCtx,
    request: Request,
    config?: HttpAuthContextConfig<TResolve, TCtx>,
  ): Promise<HttpAuthContext & TResolve>;
} {
  return (async (
    ctx: HttpContextCtx,
    request: Request,
    config?: HttpAuthContextConfig<Record<string, unknown>>,
  ) => {
    const fallback = () => resolveHttpAuthContext(auth, ctx, request);
    const authOverride = config?.authResolve
      ? await config.authResolve(ctx, fallback)
      : undefined;
    const resolved =
      authOverride === undefined ? await fallback() : authOverride;

    if (resolved === null) {
      if (config?.optional !== true) {
        throw createNotSignedInError();
      }
      return {
        ...createUnauthenticatedAuthContext(),
        source: null,
        key: null,
      };
    }

    const extra = config?.resolve
      ? await config.resolve(ctx, resolved.user, resolved)
      : {};

    return {
      ...resolved,
      ...extra,
    };
  }) as {
    <
      TResolve extends Record<string, unknown> = Record<string, never>,
      TCtx extends HttpContextCtx = HttpContextCtx,
    >(
      ctx: TCtx,
      request: Request,
      config: HttpAuthContextConfig<TResolve, TCtx> & {
        optional: true;
      },
    ): Promise<OptionalHttpAuthContext & TResolve>;
    <
      TResolve extends Record<string, unknown> = Record<string, never>,
      TCtx extends HttpContextCtx = HttpContextCtx,
    >(
      ctx: TCtx,
      request: Request,
      config?: HttpAuthContextConfig<TResolve, TCtx>,
    ): Promise<HttpAuthContext & TResolve>;
  };
}

export function createHttpAction(
  auth: {
    key: {
      verify: (
        ctx: GenericActionCtx<GenericDataModel>,
        rawKey: string,
      ) => Promise<{
        userId: string;
        keyId: string;
        scopes: HttpKeyContext["key"]["scopes"];
      }>;
    };
  },
  defaultOrigins: string[] | (() => string[]),
) {
  return (
    handler: (
      ctx: GenericActionCtx<GenericDataModel> & HttpKeyContext,
      request: Request,
    ) => Promise<Response | Record<string, unknown>>,
    options?: {
      scope?: { resource: string; action: string };
      cors?: CorsConfig;
    },
  ) => {
    return httpActionGeneric(async (genericCtx, request) => {
      const corsHeaders = buildCorsHeaders(
        request,
        options?.cors,
        defaultOrigins,
      );

      return runBoundary(
        Effect.tryPromise({
          try: async () => {
            const authHeader = request.headers.get("Authorization");
            if (!authHeader?.startsWith("Bearer ")) {
              return new Response(
                JSON.stringify({
                  error: "Missing or malformed Authorization: Bearer header.",
                  code: "MISSING_BEARER_TOKEN",
                }),
                {
                  status: 401,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }

            const rawKey = authHeader.slice(7);
            const keyResult = await Effect.runPromise(
              Effect.tryPromise({
                try: () => auth.key.verify(genericCtx, rawKey),
                catch: (error) => error,
              }).pipe(
                Effect.match({
                  onFailure: (error) => ({ ok: false as const, error }),
                  onSuccess: (value) => ({ ok: true as const, value }),
                }),
              ),
            );

            if (!keyResult.ok) {
              if (
                keyResult.error instanceof ConvexError &&
                typeof keyResult.error.data === "object" &&
                keyResult.error.data !== null &&
                "code" in keyResult.error.data &&
                "message" in keyResult.error.data
              ) {
                const { code, message } = keyResult.error.data as {
                  code: string;
                  message: string;
                };
                return new Response(JSON.stringify({ error: message, code }), {
                  status: 403,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                });
              }
              throw keyResult.error;
            }

            if (
              options?.scope &&
              !keyResult.value.scopes.can(
                options.scope.resource,
                options.scope.action,
              )
            ) {
              return new Response(
                JSON.stringify({
                  error: "This API key does not have the required permissions.",
                  code: "SCOPE_CHECK_FAILED",
                }),
                {
                  status: 403,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }

            const enrichedCtx = Object.assign(genericCtx, {
              key: {
                userId: keyResult.value.userId,
                keyId: keyResult.value.keyId,
                scopes: keyResult.value.scopes,
              },
            });
            const result = await handler(enrichedCtx, request);

            return result instanceof Response
              ? (() => {
                  const headers = new Headers(result.headers);
                  for (const [k, val] of Object.entries(corsHeaders)) {
                    if (!headers.has(k)) headers.set(k, val);
                  }
                  return new Response(result.body, {
                    status: result.status,
                    statusText: result.statusText,
                    headers,
                  });
                })()
              : new Response(JSON.stringify(result), {
                  status: 200,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                });
          },
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              logError(error);
              return new Response(
                JSON.stringify({
                  error: "An unexpected error occurred.",
                  code: "INTERNAL_ERROR",
                }),
                {
                  status: 500,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                },
              );
            }),
          ),
        ),
      );
    });
  };
}

export function createHttpRoute(
  wrapAction: ReturnType<typeof createHttpAction>,
  defaultOrigins: string[] | (() => string[]),
) {
  return (
    http: { route: (config: unknown) => void },
    routeConfig: {
      path: string;
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      handler: (
        ctx: GenericActionCtx<GenericDataModel> & HttpKeyContext,
        request: Request,
      ) => Promise<Response | Record<string, unknown>>;
      scope?: { resource: string; action: string };
      cors?: CorsConfig;
    },
  ) => {
    http.route({
      path: routeConfig.path,
      method: "OPTIONS",
      handler: httpActionGeneric(async (_ctx, request) => {
        const corsHeaders = buildCorsHeaders(
          request,
          routeConfig.cors,
          defaultOrigins,
        );
        return new Response(null, { status: 204, headers: corsHeaders });
      }),
    });

    http.route({
      path: routeConfig.path,
      method: routeConfig.method,
      handler: wrapAction(routeConfig.handler, {
        scope: routeConfig.scope,
        cors: routeConfig.cors,
      }),
    });
  };
}

export function convertErrorsToResponse(
  errorStatusCode: number,
  action: (
    ctx: GenericActionCtx<GenericDataModel>,
    request: Request,
  ) => Promise<Response>,
) {
  return async (ctx: GenericActionCtx<GenericDataModel>, request: Request) => {
    return runBoundary(
      Effect.tryPromise({
        try: () => action(ctx, request),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (
              error instanceof ConvexError &&
              typeof error.data === "object" &&
              error.data !== null &&
              "code" in error.data &&
              "message" in error.data
            ) {
              return new Response(
                JSON.stringify({
                  code: error.data.code,
                  message: error.data.message,
                }),
                {
                  status: errorStatusCode,
                  headers: { "Content-Type": "application/json" },
                },
              );
            }
            if (error instanceof ConvexError) {
              return new Response(null, {
                status: errorStatusCode,
                statusText:
                  typeof error.data === "string" ? error.data : "Error",
              });
            }
            logError(error);
            return new Response(null, {
              status: 500,
              statusText: "Internal Server Error",
            });
          }),
        ),
      ),
    );
  };
}

export function getCookies(
  request: Request,
): Record<string, string | undefined> {
  return parseCookies(request.headers.get("Cookie") ?? "");
}

export type SSORuntimeRoute = {
  pathname?: string;
  connectionId: string;
  protocol: "oidc" | "saml" | "scim";
  rest: string[];
};

function parseConnectionRuntimeRoute(
  pathname: string,
  routeBase: string,
): SSORuntimeRoute | null {
  const runtimePrefix = `${routeBase}/`;
  const runtimeParts = pathname.startsWith(runtimePrefix)
    ? pathname.slice(runtimePrefix.length).split("/").filter(Boolean)
    : [];
  const [runtimeConnectionId, protocol, ...rest] = runtimeParts;
  if (
    runtimeConnectionId === undefined ||
    (protocol !== "oidc" && protocol !== "saml" && protocol !== "scim") ||
    rest.length === 0
  ) {
    return null;
  }
  return {
    pathname,
    connectionId: runtimeConnectionId,
    protocol,
    rest,
  };
}

export function addOpenIdRoutes(
  http: HttpRouter,
  deps: {
    getIssuer: () => string;
    getJwks: () => string;
  },
) {
  const cacheControl =
    "public, max-age=15, stale-while-revalidate=15, stale-if-error=86400";

  http.route({
    path: "/.well-known/openid-configuration",
    method: "GET",
    handler: httpActionGeneric(async () => {
      const issuer = deps.getIssuer();
      return new Response(
        JSON.stringify({
          issuer,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": cacheControl,
          },
        },
      );
    }),
  });

  http.route({
    path: "/.well-known/jwks.json",
    method: "GET",
    handler: httpActionGeneric(async () => {
      return new Response(deps.getJwks(), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": cacheControl,
        },
      });
    }),
  });
}

export function addAuthRoutes(
  http: HttpRouter,
  deps: {
    handleSignIn: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
    ) => Promise<Response>;
    handleCallback: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
    ) => Promise<Response>;
  },
) {
  http.route({
    pathPrefix: "/api/auth/signin/",
    method: "GET",
    handler: httpActionGeneric(deps.handleSignIn),
  });

  const callbackHandler = httpActionGeneric(deps.handleCallback);

  http.route({
    pathPrefix: "/api/auth/callback/",
    method: "GET",
    handler: callbackHandler,
  });

  http.route({
    pathPrefix: "/api/auth/callback/",
    method: "POST",
    handler: callbackHandler,
  });
}

export function addSSORoutes(
  http: HttpRouter,
  deps: {
    routeBase: string;
    sharedOidcCallbackPath?: string;
    convertErrorsToResponse: typeof convertErrorsToResponse;
    handleSamlMetadata: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleSamlSignIn: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleOidcSignIn: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleOidcCallback: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleOidcSharedCallback: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
    ) => Promise<Response>;
    handleSamlAcs: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleSamlSlo: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleScimRequest: (
      ctx: GenericActionCtx<GenericDataModel>,
      request: Request,
    ) => Promise<Response>;
    scimError: (status: number, scimType: string, detail: string) => Response;
  },
) {
  const routePrefix = `${deps.routeBase}/`;
  const sharedOidcCallbackPath = deps.sharedOidcCallbackPath
    ? (() => {
        if (/^https?:\/\//.test(deps.sharedOidcCallbackPath)) {
          return new URL(deps.sharedOidcCallbackPath).pathname;
        }
        return deps.sharedOidcCallbackPath.startsWith("/")
          ? deps.sharedOidcCallbackPath
          : `/${deps.sharedOidcCallbackPath}`;
      })()
    : undefined;

  if (sharedOidcCallbackPath) {
    http.route({
      path: sharedOidcCallbackPath,
      method: "GET",
      handler: httpActionGeneric(
        deps.convertErrorsToResponse(400, async (ctx, request) =>
          deps.handleOidcSharedCallback(ctx, request),
        ),
      ),
    });

    http.route({
      path: sharedOidcCallbackPath,
      method: "POST",
      handler: httpActionGeneric(
        deps.convertErrorsToResponse(400, async (ctx, request) =>
          deps.handleOidcSharedCallback(ctx, request),
        ),
      ),
    });
  }

  http.route({
    pathPrefix: routePrefix,
    method: "GET",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseConnectionRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (!route) {
          throw new ConvexError({
            code: "INVALID_PARAMETERS",
            message: "Invalid connection runtime path.",
          });
        }
        if (route.protocol === "saml" && route.rest.length === 1) {
          if (route.rest[0] === "metadata") {
            return await deps.handleSamlMetadata(ctx, request, route);
          }
          if (route.rest[0] === "signin") {
            return await deps.handleSamlSignIn(ctx, request, route);
          }
          if (route.rest[0] === "acs") {
            return await deps.handleSamlAcs(ctx, request, route);
          }
          if (route.rest[0] === "slo") {
            return await deps.handleSamlSlo(ctx, request, route);
          }
        }
        if (route.protocol === "oidc" && route.rest.length === 1) {
          if (route.rest[0] === "signin") {
            return await deps.handleOidcSignIn(ctx, request, route);
          }
          if (route.rest[0] === "callback") {
            return await deps.handleOidcCallback(ctx, request, route);
          }
        }
        if (route.protocol === "scim" && route.rest[0] === "v2") {
          return await deps.handleScimRequest(ctx, request);
        }
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "Invalid connection runtime path.",
        });
      }),
    ),
  });

  http.route({
    pathPrefix: routePrefix,
    method: "POST",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseConnectionRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (route?.protocol === "saml" && route.rest.length === 1) {
          if (route.rest[0] === "acs") {
            return await deps.handleSamlAcs(ctx, request, route);
          }
          if (route.rest[0] === "slo") {
            return await deps.handleSamlSlo(ctx, request, route);
          }
        }
        if (route?.protocol === "scim" && route.rest[0] === "v2") {
          return await deps.handleScimRequest(ctx, request);
        }
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "Invalid connection runtime path.",
        });
      }),
    ),
  });

  http.route({
    pathPrefix: routePrefix,
    method: "PUT",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseConnectionRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (route?.protocol === "scim" && route.rest[0] === "v2") {
          return await deps.handleScimRequest(ctx, request);
        }
        throw new ConvexError({
          code: "INVALID_PARAMETERS",
          message: "Invalid connection runtime path.",
        });
      }),
    ),
  });

  for (const method of ["PATCH", "DELETE"] as const) {
    http.route({
      pathPrefix: routePrefix,
      method,
      handler: httpActionGeneric(async (ctx, request) => {
        const route = parseConnectionRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (!route || route.protocol !== "scim" || route.rest[0] !== "v2") {
          return deps.scimError(404, "notFound", "SCIM resource not found.");
        }
        return await deps.handleScimRequest(ctx, request);
      }),
    });
  }
}
