import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  httpActionGeneric,
} from "convex/server";
import { ConvexError } from "convex/values";
import { parse as parseCookies } from "cookie";

import type { CorsConfig, HttpKeyContext } from "./types";
import { logError } from "./utils";

export function createHttpAction(auth: {
  key: { verify: (ctx: GenericActionCtx<any>, rawKey: string) => Promise<any> };
}) {
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
    const corsConfig = options?.cors ?? {};
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": corsConfig.origin ?? "*",
      "Access-Control-Allow-Methods":
        corsConfig.methods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        corsConfig.headers ?? "Content-Type,Authorization",
    };

    return httpActionGeneric(async (genericCtx, request) => {
      return Fx.run(
        Fx.from({
          ok: async () => {
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

            const keyResult = await Fx.run(
              Fx.attempt(
                () => auth.key.verify(genericCtx, rawKey),
                (result) => ({ ok: true, value: result }) as const,
                (error) => ({ ok: false, error }) as const,
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

            if (result instanceof Response) {
              const headers = new Headers(result.headers);
              for (const [k, val] of Object.entries(corsHeaders)) {
                if (!headers.has(k)) headers.set(k, val);
              }
              return new Response(result.body, {
                status: result.status,
                statusText: result.statusText,
                headers,
              });
            }

            return new Response(JSON.stringify(result), {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json",
              },
            });
          },
          err: (error) => error,
        }).pipe(
          Fx.recover((error) => {
            logError(error);
            return Fx.succeed(
              new Response(
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
              ),
            );
          }),
        ),
      );
    });
  };
}

export function createHttpRoute(
  wrapAction: ReturnType<typeof createHttpAction>,
) {
  return (
    http: { route: (config: any) => void },
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
    const corsConfig = routeConfig.cors ?? {};
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": corsConfig.origin ?? "*",
      "Access-Control-Allow-Methods":
        corsConfig.methods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":
        corsConfig.headers ?? "Content-Type,Authorization",
    };

    http.route({
      path: routeConfig.path,
      method: "OPTIONS",
      handler: httpActionGeneric(async () => {
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
  action: (ctx: GenericActionCtx<any>, request: Request) => Promise<Response>,
) {
  return async (ctx: GenericActionCtx<any>, request: Request) => {
    return Fx.run(
      Fx.from({
        ok: () => action(ctx, request),
        err: (error) => error,
      }).pipe(
        Fx.recover((error) => {
          if (
            error instanceof ConvexError &&
            typeof error.data === "object" &&
            error.data !== null &&
            "code" in error.data &&
            "message" in error.data
          ) {
            return Fx.succeed(
              new Response(
                JSON.stringify({
                  code: error.data.code,
                  message: error.data.message,
                }),
                {
                  status: errorStatusCode,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          } else if (error instanceof ConvexError) {
            return Fx.succeed(
              new Response(null, {
                status: errorStatusCode,
                statusText:
                  typeof error.data === "string" ? error.data : "Error",
              }),
            );
          } else {
            logError(error);
            return Fx.succeed(
              new Response(null, {
                status: 500,
                statusText: "Internal Server Error",
              }),
            );
          }
        }),
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
  enterpriseId: string;
  protocol: "oidc" | "saml" | "scim";
  rest: string[];
};

function parseEnterpriseRuntimeRoute(
  pathname: string,
  routeBase: string,
): SSORuntimeRoute | null {
  const runtimePrefix = `${routeBase}/`;
  const runtimeParts = pathname.startsWith(runtimePrefix)
    ? pathname.slice(runtimePrefix.length).split("/").filter(Boolean)
    : [];
  const [runtimeEnterpriseId, protocol, ...rest] = runtimeParts;
  if (
    runtimeEnterpriseId === undefined ||
    (protocol !== "oidc" && protocol !== "saml" && protocol !== "scim") ||
    rest.length === 0
  ) {
    return null;
  }
  return {
    pathname,
    enterpriseId: runtimeEnterpriseId,
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
      ctx: GenericActionCtx<any>,
      request: Request,
    ) => Promise<Response>;
    handleCallback: (
      ctx: GenericActionCtx<any>,
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
    convertErrorsToResponse: typeof convertErrorsToResponse;
    handleSamlMetadata: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleSamlSignIn: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleOidcSignIn: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleOidcCallback: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleSamlAcs: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleSamlSlo: (
      ctx: GenericActionCtx<any>,
      request: Request,
      route: SSORuntimeRoute,
    ) => Promise<Response>;
    handleScimRequest: (
      ctx: GenericActionCtx<any>,
      request: Request,
    ) => Promise<Response>;
    scimError: (status: number, scimType: string, detail: string) => Response;
  },
) {
  const routePrefix = `${deps.routeBase}/`;

  http.route({
    pathPrefix: routePrefix,
    method: "GET",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseEnterpriseRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (!route) {
          throw Cv.error({
            code: "INVALID_PARAMETERS",
            message: "Invalid enterprise runtime path.",
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
        throw Cv.error({
          code: "INVALID_PARAMETERS",
          message: "Invalid enterprise runtime path.",
        });
      }),
    ),
  });

  http.route({
    pathPrefix: routePrefix,
    method: "POST",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseEnterpriseRuntimeRoute(
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
        throw Cv.error({
          code: "INVALID_PARAMETERS",
          message: "Invalid enterprise runtime path.",
        });
      }),
    ),
  });

  http.route({
    pathPrefix: routePrefix,
    method: "PUT",
    handler: httpActionGeneric(
      deps.convertErrorsToResponse(400, async (ctx, request) => {
        const route = parseEnterpriseRuntimeRoute(
          new URL(request.url).pathname,
          deps.routeBase,
        );
        if (route?.protocol === "scim" && route.rest[0] === "v2") {
          return await deps.handleScimRequest(ctx, request);
        }
        throw Cv.error({
          code: "INVALID_PARAMETERS",
          message: "Invalid enterprise runtime path.",
        });
      }),
    ),
  });

  for (const method of ["PATCH", "DELETE"] as const) {
    http.route({
      pathPrefix: routePrefix,
      method,
      handler: httpActionGeneric(async (ctx, request) => {
        const route = parseEnterpriseRuntimeRoute(
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
