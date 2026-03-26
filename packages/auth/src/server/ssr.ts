import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { parse, serialize } from "cookie";
import { jwtDecode } from "jwt-decode";

import type {
  SignInAction,
  SignInActionResult,
  SignOutAction,
} from "./runtime";
import { Fx } from "@robelest/fx";
import { isLocalHost } from "./utils";

const signInActionRef: SignInAction = makeFunctionReference("auth:signIn");
const signOutActionRef: SignOutAction = makeFunctionReference("auth:signOut");

/** Cookie lifetime configuration for auth tokens. */
export type AuthCookieConfig = {
  /** Maximum age in seconds, or `null` for session cookies. */
  maxAge: number | null;
};

/** Raw cookie values extracted from a request. */
export type AuthCookies = {
  /** The JWT access token, or `null` when absent. */
  token: string | null;
  /** The refresh token, or `null` when absent. */
  refreshToken: string | null;
  /** The OAuth PKCE verifier, or `null` when absent. */
  verifier: string | null;
};

/** A structured cookie ready to be set via any framework's cookie API. */
export type AuthCookie = {
  name: string;
  value: string;
  options: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    maxAge?: number;
    expires?: Date;
  };
};

/**
 * Options for the SSR auth helper returned by {@link server}.
 */
export type ServerOptions = {
  /** Convex deployment API URL (e.g. `https://your-app.convex.cloud`). */
  url: string;
  /**
   * Accepted JWT issuers for `refresh()` and `verify()`.
   *
   * By default, this is derived from `url`. If `url` ends with
   * `.convex.cloud`, the matching `.convex.site` issuer is also accepted.
   */
  acceptedIssuers?: string[];
  /**
   * Path the client POSTs auth actions to. Defaults to `"/api/auth"`.
   * Must match the `proxyPath` option on the client.
   *
   * @defaultValue "/api/auth"
   */
  apiRoute?: string;
  /** Cookie `maxAge` in seconds, or `null` for session cookies. */
  cookieMaxAge?: number | null;
  /** Enable verbose debug logging for token refresh and cookie operations. */
  verbose?: boolean;
  /**
   * Optional namespace for auth cookie names.
   *
   * Use this to isolate auth cookies between multiple local apps on the same host.
   * If omitted, a deterministic deployment-scoped namespace is derived from `url`.
   */
  cookieNamespace?: string;
  /**
   * Control whether `refresh()` handles OAuth `?code=` query parameters.
   *
   * - `true` (default): always exchange the code on GET requests with `text/html` accept.
   * - `false`: never exchange — useful when only the client handles codes.
   * - A function: called with the `Request` for per-request decisions.
   *
   * @defaultValue true
   */
  shouldHandleCode?:
    | ((request: Request) => boolean | Promise<boolean>)
    | boolean;
};

/**
 * Result returned from `server().refresh()`.
 *
 * Covers both normal SSR refreshes and OAuth code-exchange redirects.
 */
export type RefreshResult =
  | {
      /** Code exchange occurred — return the pre-built redirect `Response`. */
      redirect: true;
      /** 302 redirect with Set-Cookie headers already serialized. */
      response: Response;
    }
  | {
      /** No redirect — apply cookies and read the token. */
      redirect: false;
      /** Structured cookies to set on the response. */
      cookies: AuthCookie[];
      /** JWT for SSR hydration, or `null` if not authenticated. */
      token: string | null;
    };

const TOKEN_COOKIE_BASE_NAME = "__convexAuthJWT";
const REFRESH_COOKIE_BASE_NAME = "__convexAuthRefreshToken";
const VERIFIER_COOKIE_BASE_NAME = "__convexAuthOAuthVerifier";
const DERIVED_COOKIE_NAMESPACE_FALLBACK = "convexauth";

/**
 * Derive the cookie names used for auth tokens.
 *
 * On localhost the names are unprefixed; on production hosts they
 * use the `__Host-` prefix for tighter security.
 *
 * @param host - The `Host` header value. Omit to use unprefixed names.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns An object with `token`, `refreshToken`, and `verifier` cookie names.
 */
export function authCookieNames(
  host?: string,
  cookieNamespace?: string | null,
) {
  const prefix = isLocalHost(host) ? "" : "__Host-";
  const namespace = normalizeCookieNamespace(cookieNamespace);
  const suffix = namespace === null ? "" : `_${namespace}`;
  return {
    token: `${prefix}${TOKEN_COOKIE_BASE_NAME}${suffix}`,
    refreshToken: `${prefix}${REFRESH_COOKIE_BASE_NAME}${suffix}`,
    verifier: `${prefix}${VERIFIER_COOKIE_BASE_NAME}${suffix}`,
  };
}

/**
 * Parse auth cookie values from a raw `Cookie` header string.
 *
 * @param cookieHeader - The raw `Cookie` header, or `null`/`undefined`.
 * @param host - The `Host` header, used to determine cookie name prefixes.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns Parsed {@link AuthCookies} with `token`, `refreshToken`, and `verifier`.
 */
export function parseAuthCookies(
  cookieHeader: string | null | undefined,
  host?: string,
  cookieNamespace?: string | null,
): AuthCookies {
  const names = authCookieNames(host, cookieNamespace);
  const parsed = parse(cookieHeader ?? "");
  return {
    token: parsed[names.token] ?? null,
    refreshToken: parsed[names.refreshToken] ?? null,
    verifier: parsed[names.verifier] ?? null,
  };
}

/**
 * Serialize auth cookies into `Set-Cookie` header strings.
 *
 * Nulled-out values produce deletion cookies (maxAge 0, expired date).
 *
 * @param cookies - The auth cookie values to serialize.
 * @param host - The `Host` header, used for cookie name prefixes and `Secure` flag.
 * @param config - Cookie lifetime config. Defaults to session cookies.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns An array of three `Set-Cookie` header strings.
 */
export function serializeAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
) {
  const names = authCookieNames(host, cookieNamespace);
  const secure = !isLocalHost(host);
  const base = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
  const maxAge = config.maxAge ?? undefined;
  const serialized = [
    serialize(names.token, cookies.token ?? "", {
      ...base,
      maxAge: cookies.token === null ? 0 : maxAge,
      expires: cookies.token === null ? new Date(0) : undefined,
    }),
    serialize(names.refreshToken, cookies.refreshToken ?? "", {
      ...base,
      maxAge: cookies.refreshToken === null ? 0 : maxAge,
      expires: cookies.refreshToken === null ? new Date(0) : undefined,
    }),
    serialize(names.verifier, cookies.verifier ?? "", {
      ...base,
      maxAge: cookies.verifier === null ? 0 : maxAge,
      expires: cookies.verifier === null ? new Date(0) : undefined,
    }),
  ];
  return serialized;
}

/**
 * Build structured cookie objects for any SSR framework.
 *
 * Use with SvelteKit's `event.cookies.set()`, TanStack Start's `setCookie()`,
 * Next.js's `cookies().set()`, or any other framework cookie API.
 *
 * @param cookies - The auth cookie values to convert.
 * @param host - The `Host` header, used for cookie name prefixes and `Secure`.
 * @param config - Cookie lifetime config. Defaults to session cookies.
 * @param cookieNamespace - Optional namespace suffix for cookie isolation.
 * @returns Structured cookie descriptors ready for framework cookie APIs.
 */
export function structuredAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
): AuthCookie[] {
  const names = authCookieNames(host, cookieNamespace);
  const secure = !isLocalHost(host);
  const base = {
    path: "/" as const,
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
  };
  const maxAge = config.maxAge ?? undefined;
  const structured: AuthCookie[] = [
    {
      name: names.token,
      value: cookies.token ?? "",
      options: {
        ...base,
        maxAge: cookies.token === null ? 0 : maxAge,
        expires: cookies.token === null ? new Date(0) : undefined,
      },
    },
    {
      name: names.refreshToken,
      value: cookies.refreshToken ?? "",
      options: {
        ...base,
        maxAge: cookies.refreshToken === null ? 0 : maxAge,
        expires: cookies.refreshToken === null ? new Date(0) : undefined,
      },
    },
    {
      name: names.verifier,
      value: cookies.verifier ?? "",
      options: {
        ...base,
        maxAge: cookies.verifier === null ? 0 : maxAge,
        expires: cookies.verifier === null ? new Date(0) : undefined,
      },
    },
  ];

  return structured;
}

/**
 * Check whether a request pathname matches the auth proxy route.
 *
 * Handles trailing-slash ambiguity: both `/api/auth` and `/api/auth/`
 * match regardless of how `apiRoute` is configured.
 *
 * @param pathname - The request URL pathname.
 * @param apiRoute - The configured proxy route (e.g. `"/api/auth"`).
 * @returns `true` when the pathname matches the proxy route.
 *
 * @see {@link server}
 */
export function shouldProxyAuthAction(pathname: string, apiRoute: string) {
  if (apiRoute.endsWith("/")) {
    return pathname === apiRoute || pathname === apiRoute.slice(0, -1);
  }
  return pathname === apiRoute || pathname === `${apiRoute}/`;
}

const REQUIRED_TOKEN_LIFETIME_MS = 60_000;
const MINIMUM_REQUIRED_TOKEN_LIFETIME_MS = 10_000;

type DecodedToken = { exp?: number; iat?: number; iss?: string };

function normalizeCookieNamespace(cookieNamespace?: string | null) {
  if (cookieNamespace === undefined || cookieNamespace === null) {
    return null;
  }
  const normalized = cookieNamespace
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Safely check if a string is a valid URL without throwing.
 */
function canParseUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function serializeAuthCookie(cookie: AuthCookie): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.options.path}`,
  ];
  if (cookie.options.httpOnly) parts.push("HttpOnly");
  if (cookie.options.secure) parts.push("Secure");
  if (cookie.options.sameSite)
    parts.push(`SameSite=${cookie.options.sameSite}`);
  if (cookie.options.maxAge !== undefined)
    parts.push(`Max-Age=${cookie.options.maxAge}`);
  if (cookie.options.expires)
    parts.push(`Expires=${cookie.options.expires.toUTCString()}`);
  return parts.join("; ");
}

function buildRedirectResponse(
  location: string,
  cookies: AuthCookie[],
): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", serializeAuthCookie(cookie));
  }
  return new Response(null, { status: 302, headers });
}

function deriveCookieNamespaceFromUrl(url: string) {
  if (!canParseUrl(url)) return DERIVED_COOKIE_NAMESPACE_FALLBACK;
  const parsed = new URL(url);
  const raw = `${parsed.hostname}${parsed.pathname}`;
  return normalizeCookieNamespace(raw) ?? DERIVED_COOKIE_NAMESPACE_FALLBACK;
}

function normalizeIssuer(value: string) {
  if (!canParseUrl(value)) return value.replace(/\/+$/, "");
  const parsed = new URL(value);
  const pathname =
    parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function convexSiteIssuerFromCloudUrl(value: string) {
  if (!canParseUrl(value)) return null;
  const parsed = new URL(value);
  if (!parsed.hostname.endsWith(".convex.cloud")) {
    return null;
  }
  parsed.hostname =
    parsed.hostname.slice(0, -".convex.cloud".length) + ".convex.site";
  return normalizeIssuer(parsed.toString());
}

function defaultAcceptedIssuersForUrl(value: string) {
  const issuers = [normalizeIssuer(value)];
  const siteIssuer = convexSiteIssuerFromCloudUrl(value);
  if (siteIssuer !== null) {
    issuers.push(siteIssuer);
  }
  return issuers;
}

/**
 * Create an SSR auth helper for server-side frameworks.
 *
 * Handles cookie-based token management, OAuth code exchange,
 * and automatic JWT refresh on page loads. Works with any
 * framework that gives you a `Request` object — SvelteKit,
 * TanStack Start, Remix, Next.js, etc.
 *
 * @param options - SSR configuration (Convex API URL, issuer rules, proxy route, cookie lifetime).
 * @returns An object with `token`, `verify`, `proxy`, and `refresh` methods.
 *
 * @example SvelteKit hooks
 * ```ts
 * // src/hooks.server.ts
 * import { server } from '@robelest/convex-auth/server';
 *
 * const auth = server({ url: CONVEX_URL });
 *
 * export const handle = async ({ event, resolve }) => {
 *   const { cookies, token } = await auth.refresh(event.request);
 *   for (const c of cookies) event.cookies.set(c.name, c.value, c.options);
 *   event.locals.token = token;
 *   return resolve(event);
 * };
 * ```
 *
 * @example Generic proxy endpoint
 * ```ts
 * if (shouldProxyAuthAction(url.pathname, '/api/auth')) {
 *   return auth.proxy(request);
 * }
 * ```
 *
 * @param options - Server-side auth configuration including Convex URL,
 *   accepted issuers, proxy route, and cookie behavior.
 * @returns SSR helpers for reading tokens, refreshing cookies, and proxying
 *   auth actions through an httpOnly-cookie layer.
 *
 * @see {@link shouldProxyAuthAction}
 */
export function server(options: ServerOptions) {
  const convexUrl = options.url;
  const apiRoute = options.apiRoute ?? "/api/auth";
  const cookieConfig = { maxAge: options.cookieMaxAge ?? null };
  const verbose = options.verbose ?? false;
  const cookieNamespace =
    normalizeCookieNamespace(options.cookieNamespace) ??
    deriveCookieNamespaceFromUrl(convexUrl);
  const acceptedIssuers = new Set(
    (options.acceptedIssuers ?? defaultAcceptedIssuersForUrl(convexUrl))
      .map(normalizeIssuer)
      .filter((issuer) => issuer.length > 0),
  );

  return {
    /**
     * Read the JWT from the request cookies without any validation.
     *
     * @param request - The incoming HTTP request.
     * @returns The raw JWT string, or `null` when no token cookie exists.
     */
    token(request: Request): string | null {
      return parseAuthCookies(
        request.headers.get("cookie"),
        request.headers.get("host") ?? new URL(request.url).host,
        cookieNamespace,
      ).token;
    },

    /**
     * Check whether the request carries a non-expired JWT.
     *
     * Performs local expiration checking only (no network call).
     * Use for lightweight auth guards in middleware.
     *
     * @param request - The incoming HTTP request.
     * @returns `true` when a valid, non-expired JWT exists in the cookies.
     */
    async verify(request: Request): Promise<boolean> {
      const token = parseAuthCookies(
        request.headers.get("cookie"),
        request.headers.get("host") ?? new URL(request.url).host,
        cookieNamespace,
      ).token;
      if (token === null) {
        return false;
      }
      const decodedToken = await Fx.run(
        Fx.attempt(
          async () => jwtDecode<DecodedToken>(token),
          (decoded) => decoded,
          () => null,
        ),
      );
      if (decodedToken?.exp === undefined || decodedToken.iss === undefined) {
        return false;
      }
      if (!acceptedIssuers.has(normalizeIssuer(decodedToken.iss))) {
        return false;
      }
      return decodedToken.exp * 1000 > Date.now();
    },

    /**
     * Handle a proxied `signIn` or `signOut` POST from the client.
     *
     * Validates the route, method, and origin, then forwards the
     * action to Convex and returns a `Response` with updated
     * `Set-Cookie` headers. The client never sees the real
     * refresh token — it stays in httpOnly cookies.
     *
     * @param request - The incoming POST request from the client.
     * @returns A JSON `Response` with auth result and cookie headers.
     */
    async proxy(request: Request): Promise<Response> {
      const requestUrl = new URL(request.url);
      const requestDispatch = !shouldProxyAuthAction(
        requestUrl.pathname,
        apiRoute,
      )
        ? { kind: "invalidRoute" as const }
        : request.method !== "POST"
          ? { kind: "invalidMethod" as const }
          : (() => {
                const originHeader = request.headers.get("origin");
                if (originHeader === null) {
                  return false;
                }
                const forwardedProtoHeader =
                  request.headers.get("x-forwarded-proto");
                const protocol =
                  forwardedProtoHeader !== null
                    ? (() => {
                        const forwardedProto = forwardedProtoHeader
                          .split(",")[0]
                          ?.trim();
                        if (
                          forwardedProto !== undefined &&
                          forwardedProto.length > 0
                        ) {
                          return forwardedProto.endsWith(":")
                            ? forwardedProto
                            : `${forwardedProto}:`;
                        }
                        return new URL(request.url).protocol;
                      })()
                    : new URL(request.url).protocol;
                const requestHost =
                  request.headers.get("host") ?? new URL(request.url).host;
                const hostCandidate = `${protocol}//${requestHost}`;
                const host = canParseUrl(hostCandidate)
                  ? new URL(hostCandidate).host
                  : requestHost;
                if (!canParseUrl(originHeader)) {
                  return true;
                }
                const originUrl = new URL(originHeader);
                return (
                  originUrl.host !== host || originUrl.protocol !== protocol
                );
              })()
            ? { kind: "invalidOrigin" as const }
            : { kind: "valid" as const };

      const validationErrorResponse = await Fx.run(
        Fx.match(requestDispatch, requestDispatch.kind, {
          invalidRoute: () => new Response("Invalid route", { status: 404 }),
          invalidMethod: () => new Response("Invalid method", { status: 405 }),
          invalidOrigin: () => new Response("Invalid origin", { status: 403 }),
          valid: () => null,
        }),
      );
      if (validationErrorResponse !== null) {
        return validationErrorResponse;
      }

      const body = await Fx.run(
        Fx.attempt(
          async () => {
            const parsed = await request.json();
            if (typeof parsed !== "object" || parsed === null) {
              return null;
            }
            return parsed as Record<string, unknown>;
          },
          (parsed) => parsed,
          () => null,
        ),
      );
      if (body === null) {
        return new Response("Invalid request body", { status: 400 });
      }

      const action = body.action as string;
      const args =
        typeof body.args === "object" && body.args !== null
          ? (body.args as Record<string, any>)
          : {};

      const actionDispatch =
        action === "auth:signIn"
          ? { action: "sessionStart" as const }
          : action === "auth:signOut"
            ? { action: "sessionStop" as const }
            : null;

      if (actionDispatch === null) {
        return new Response("Invalid action", { status: 400 });
      }

      const host = request.headers.get("host") ?? new URL(request.url).host;
      const currentCookies = parseAuthCookies(
        request.headers.get("cookie"),
        host,
        cookieNamespace,
      );

      return Fx.run(
        Fx.match(actionDispatch, actionDispatch.action, {
          sessionStart: (_) =>
            Fx.from({
              ok: async () => {
                const refreshDispatch =
                  args.refreshToken === undefined
                    ? { kind: "passthrough" as const }
                    : currentCookies.refreshToken === null
                      ? { kind: "refreshRequestedWithoutCookie" as const }
                      : {
                          kind: "hydrateRefreshFromCookie" as const,
                          refreshToken: currentCookies.refreshToken,
                        };

                const refreshResponse = await Fx.run(
                  Fx.match(refreshDispatch, refreshDispatch.kind, {
                    passthrough: async () => null,
                    hydrateRefreshFromCookie: async ({ refreshToken }) => {
                      args.refreshToken = refreshToken;
                      return null;
                    },
                    refreshRequestedWithoutCookie: async () => {
                      const currentToken = currentCookies.token;
                      const decodedToken =
                        currentToken === null
                          ? null
                          : await Fx.run(
                              Fx.attempt(
                                async () =>
                                  jwtDecode<DecodedToken>(currentToken),
                                (decoded) => decoded,
                                () => null,
                              ),
                            );
                      const tokenDispatch =
                        currentToken !== null &&
                        decodedToken?.exp !== undefined &&
                        decodedToken.iss !== undefined &&
                        acceptedIssuers.has(
                          normalizeIssuer(decodedToken.iss),
                        ) &&
                        decodedToken.exp * 1000 > Date.now()
                          ? {
                              kind: "validToken" as const,
                              token: currentToken,
                            }
                          : { kind: "missingToken" as const };
                      return await Fx.run(
                        Fx.match(tokenDispatch, tokenDispatch.kind, {
                          validToken: ({ token }) =>
                            new Response(
                              JSON.stringify({
                                tokens: {
                                  token,
                                  refreshToken: "dummy",
                                },
                              }),
                              {
                                status: 200,
                                headers: {
                                  "Content-Type": "application/json",
                                },
                              },
                            ),
                          missingToken: () =>
                            new Response(JSON.stringify({ tokens: null }), {
                              status: 200,
                              headers: {
                                "Content-Type": "application/json",
                              },
                            }),
                        }),
                      );
                    },
                  }),
                );
                const refreshDecision =
                  refreshResponse !== null
                    ? {
                        kind: "shortCircuit" as const,
                        response: refreshResponse,
                      }
                    : { kind: "continue" as const };
                const maybeShortCircuitResponse = await Fx.run(
                  Fx.match(refreshDecision, refreshDecision.kind, {
                    shortCircuit: ({ response }) => response,
                    continue: () => null,
                  }),
                );
                if (maybeShortCircuitResponse !== null) {
                  return maybeShortCircuitResponse;
                }

                const client = new ConvexHttpClient(convexUrl);
                const authDispatch =
                  args.refreshToken === undefined &&
                  args.params?.code === undefined &&
                  currentCookies.token !== null
                    ? {
                        kind: "attachAuth" as const,
                        token: currentCookies.token,
                      }
                    : { kind: "skipAuth" as const };
                await Fx.run(
                  Fx.match(authDispatch, authDispatch.kind, {
                    attachAuth: ({ token }) => {
                      client.setAuth(token);
                    },
                    skipAuth: () => undefined,
                  }),
                );
                return Fx.run(
                  Fx.from({
                    ok: () => client.action(signInActionRef, args),
                    err: (error) => error,
                  }).pipe(
                    Fx.fold({
                      ok: (result: SignInActionResult) =>
                        Fx.run(
                          Fx.match(result, result.kind, {
                            redirect: (redirectResult) => {
                              const response = new Response(
                                JSON.stringify({
                                  kind: "redirect",
                                  redirect: redirectResult.redirect,
                                  verifier: redirectResult.verifier,
                                }),
                                {
                                  status: 200,
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                },
                              );
                              for (const value of serializeAuthCookies(
                                {
                                  ...currentCookies,
                                  verifier: redirectResult.verifier,
                                },
                                host,
                                cookieConfig,
                                cookieNamespace,
                              )) {
                                response.headers.append("Set-Cookie", value);
                              }
                              return Fx.succeed(response);
                            },
                            signedIn: (signedInResult) => {
                              const response = new Response(
                                JSON.stringify({
                                  kind: "signedIn",
                                  tokens:
                                    signedInResult.tokens === null
                                      ? null
                                      : {
                                          token: signedInResult.tokens.token,
                                          refreshToken: "dummy",
                                        },
                                }),
                                {
                                  status: 200,
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                },
                              );
                              for (const value of serializeAuthCookies(
                                {
                                  token: signedInResult.tokens?.token ?? null,
                                  refreshToken:
                                    signedInResult.tokens?.refreshToken ?? null,
                                  verifier: null,
                                },
                                host,
                                cookieConfig,
                                cookieNamespace,
                              )) {
                                response.headers.append("Set-Cookie", value);
                              }
                              return Fx.succeed(response);
                            },
                            started: (startedResult) =>
                              Fx.succeed(
                                new Response(JSON.stringify(startedResult), {
                                  status: 200,
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                }),
                              ),
                            passkeyOptions: (passkeyOptionsResult) =>
                              Fx.succeed(
                                new Response(
                                  JSON.stringify(passkeyOptionsResult),
                                  {
                                    status: 200,
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                  },
                                ),
                              ),
                            totpRequired: (totpRequiredResult) =>
                              Fx.succeed(
                                new Response(
                                  JSON.stringify(totpRequiredResult),
                                  {
                                    status: 200,
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                  },
                                ),
                              ),
                            totpSetup: (totpSetupResult) =>
                              Fx.succeed(
                                new Response(JSON.stringify(totpSetupResult), {
                                  status: 200,
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                }),
                              ),
                            deviceCode: (deviceCodeResult) =>
                              Fx.succeed(
                                new Response(JSON.stringify(deviceCodeResult), {
                                  status: 200,
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                }),
                              ),
                          }),
                        ),
                      err: (error: unknown) => {
                        const errorBody =
                          error instanceof ConvexError &&
                          typeof error.data === "object" &&
                          error.data !== null &&
                          "code" in error.data
                            ? {
                                error:
                                  (error.data as { message?: string })
                                    .message ?? String(error),
                                authError: error.data,
                              }
                            : {
                                error:
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                              };
                        const response = new Response(
                          JSON.stringify(errorBody),
                          {
                            status: 400,
                            headers: {
                              "Content-Type": "application/json",
                            },
                          },
                        );
                        const clearSession =
                          args.refreshToken !== undefined &&
                          error instanceof ConvexError &&
                          typeof error.data === "object" &&
                          error.data !== null &&
                          (error.data as Record<string, unknown>).code ===
                            "INVALID_REFRESH_TOKEN";
                        for (const value of serializeAuthCookies(
                          {
                            token: clearSession ? null : currentCookies.token,
                            refreshToken: clearSession
                              ? null
                              : currentCookies.refreshToken,
                            verifier: null,
                          },
                          host,
                          cookieConfig,
                          cookieNamespace,
                        )) {
                          response.headers.append("Set-Cookie", value);
                        }
                        return response;
                      },
                    }),
                  ),
                );
              },
              err: (e) => e as never,
            }),
          sessionStop: (_) =>
            Fx.from({
              ok: async () => {
                await Fx.run(
                  Fx.from({
                    ok: () =>
                      (() => {
                        const client = new ConvexHttpClient(convexUrl);
                        if (currentCookies.token !== null) {
                          client.setAuth(currentCookies.token);
                        }
                        return client.action(signOutActionRef);
                      })(),
                    err: (error) => error,
                  }).pipe(
                    Fx.recover((error: unknown) => {
                      console.error(
                        "[convex-auth/server] proxy sign-out failed",
                        error,
                      );
                      const fallbackDispatch =
                        currentCookies.refreshToken !== null
                          ? {
                              kind: "attemptFallback" as const,
                              refreshToken: currentCookies.refreshToken,
                            }
                          : { kind: "skipFallback" as const };
                      return Fx.match(fallbackDispatch, fallbackDispatch.kind, {
                        attemptFallback: ({ refreshToken }) =>
                          Fx.from({
                            ok: async () => {
                              const refreshClient = new ConvexHttpClient(
                                convexUrl,
                              );
                              const refreshed = (await refreshClient.action(
                                signInActionRef,
                                {
                                  refreshToken,
                                },
                              )) as SignInActionResult;
                              const refreshedTokens = await Fx.run(
                                Fx.match(refreshed, refreshed.kind, {
                                  signedIn: (signedInResult) =>
                                    Fx.succeed(signedInResult.tokens),
                                  redirect: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                  started: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                  passkeyOptions: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                  totpRequired: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                  totpSetup: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                  deviceCode: () =>
                                    Fx.fatal(
                                      new Error(
                                        "Invalid `auth:signIn` result for sign-out fallback refresh",
                                      ),
                                    ),
                                }),
                              );
                              const fallbackSignOutDispatch =
                                refreshedTokens !== null
                                  ? {
                                      kind: "signOutWithRefreshed" as const,
                                      token: refreshedTokens.token,
                                    }
                                  : { kind: "skipRefreshedSignOut" as const };
                              await Fx.run(
                                Fx.match(
                                  fallbackSignOutDispatch,
                                  fallbackSignOutDispatch.kind,
                                  {
                                    signOutWithRefreshed: ({ token }) =>
                                      Fx.from({
                                        ok: async () => {
                                          const client = new ConvexHttpClient(
                                            convexUrl,
                                          );
                                          client.setAuth(token);
                                          await client.action(signOutActionRef);
                                        },
                                        err: (error) => error,
                                      }),
                                    skipRefreshedSignOut: () => Fx.succeed(undefined),
                                  },
                                ),
                              );
                            },
                            err: (fallbackError) => fallbackError,
                          }).pipe(
                            Fx.recover((fallbackError: unknown) => {
                              console.error(
                                "[convex-auth/server] proxy sign-out fallback failed",
                                fallbackError,
                              );
                              return Fx.succeed(undefined);
                            }),
                          ),
                        skipFallback: () => Fx.succeed(undefined),
                      });
                    }),
                    Fx.map(() => undefined),
                  ),
                );
                const response = new Response(JSON.stringify(null), {
                  status: 200,
                  headers: {
                    "Content-Type": "application/json",
                  },
                });
                for (const value of serializeAuthCookies(
                  {
                    token: null,
                    refreshToken: null,
                    verifier: null,
                  },
                  host,
                  cookieConfig,
                  cookieNamespace,
                )) {
                  response.headers.append("Set-Cookie", value);
                }
                return response;
              },
              err: (e) => e as never,
            }),
        }),
      );
    },

    /**
     * Refresh auth tokens on page load.
     *
     * Call this in your server hooks/middleware on every request.
     * It handles three scenarios:
     *
     * 1. **OAuth code exchange** — exchanges a `?code=` query param for tokens and returns a redirect URL.
     * 2. **Token refresh** — refreshes the JWT if it's close to expiry.
     * 3. **No-op** — returns the existing token when no refresh is needed.
     *
     * @param request - The incoming HTTP request.
     * @returns Structured cookies to set on the response, an optional redirect URL, and the current JWT.
     */
    async refresh(request: Request): Promise<RefreshResult> {
      const host = request.headers.get("host") ?? new URL(request.url).host;
      const currentCookies = parseAuthCookies(
        request.headers.get("cookie"),
        host,
        cookieNamespace,
      );
      const currentToken = currentCookies.token;

      // CORS request — do not mutate auth cookies from cross-origin requests.
      const originHeader = request.headers.get("origin");
      const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
      const protocol =
        forwardedProtoHeader !== null
          ? (() => {
              const forwardedProto = forwardedProtoHeader.split(",")[0]?.trim();
              if (forwardedProto !== undefined && forwardedProto.length > 0) {
                return forwardedProto.endsWith(":")
                  ? forwardedProto
                  : `${forwardedProto}:`;
              }
              return new URL(request.url).protocol;
            })()
          : new URL(request.url).protocol;
      const requestHost =
        request.headers.get("host") ?? new URL(request.url).host;
      const hostCandidate = `${protocol}//${requestHost}`;
      const normalizedHost = canParseUrl(hostCandidate)
        ? new URL(hostCandidate).host
        : requestHost;
      const originUrl =
        originHeader !== null && canParseUrl(originHeader)
          ? new URL(originHeader)
          : null;
      const corsRequest =
        originHeader !== null &&
        (originUrl === null ||
          originUrl.host !== normalizedHost ||
          originUrl.protocol !== protocol);
      const corsDispatch = corsRequest
        ? { kind: "crossOrigin" as const }
        : { kind: "sameOrigin" as const };
      const corsRefreshResult = await Fx.run(
        Fx.match(corsDispatch, corsDispatch.kind, {
          crossOrigin: () =>
            ({
              redirect: false,
              cookies: [],
              token: null,
            }) satisfies RefreshResult,
          sameOrigin: () => null,
        }),
      );
      if (corsRefreshResult !== null) {
        return corsRefreshResult;
      }

      // OAuth code exchange — exchange code for tokens and redirect.
      const requestUrl = new URL(request.url);
      const code = requestUrl.searchParams.get("code");
      const shouldHandleCode =
        options.shouldHandleCode === undefined
          ? true
          : typeof options.shouldHandleCode === "function"
            ? await options.shouldHandleCode(request)
            : options.shouldHandleCode;

      const codeExchangeDispatch =
        code !== null &&
        request.method === "GET" &&
        request.headers.get("accept")?.includes("text/html") &&
        shouldHandleCode
          ? { kind: "exchange" as const, code }
          : { kind: "skip" as const };
      const codeExchangeResult = await Fx.run(
        Fx.match(codeExchangeDispatch, codeExchangeDispatch.kind, {
          exchange: async ({
            code: verificationCode,
          }): Promise<RefreshResult> => {
            const redirectUrl = new URL(requestUrl.toString());
            return Fx.run(
              Fx.from({
                ok: async () => {
                  const client = new ConvexHttpClient(convexUrl);
                  const result = (await client.action(signInActionRef, {
                    params: { code: verificationCode },
                    verifier: currentCookies.verifier ?? undefined,
                  })) as SignInActionResult;
                  const tokens = await Fx.run(
                    Fx.match(result, result.kind, {
                      signedIn: (signedInResult) =>
                        Fx.succeed(signedInResult.tokens),
                      redirect: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                      started: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                      passkeyOptions: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                      totpRequired: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                      totpSetup: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                      deviceCode: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for code exchange",
                          ),
                        ),
                    }),
                  );
                  return { kind: "signedIn" as const, tokens };
                },
                err: (error) => error,
              }).pipe(
                Fx.fold({
                  ok: (result): RefreshResult => {
                    redirectUrl.searchParams.delete("code");
                    const cookies = structuredAuthCookies(
                      {
                        token: result.tokens?.token ?? null,
                        refreshToken: result.tokens?.refreshToken ?? null,
                        verifier: null,
                      },
                      host,
                      cookieConfig,
                      cookieNamespace,
                    );
                    return {
                      redirect: true,
                      response: buildRedirectResponse(
                        redirectUrl.toString(),
                        cookies,
                      ),
                    };
                  },
                  err: (error: unknown): RefreshResult => {
                    console.error(
                      "[convex-auth/server] code exchange failed",
                      error,
                    );
                    const errorCode =
                      error instanceof ConvexError &&
                      typeof error.data === "object" &&
                      error.data !== null &&
                      typeof (error.data as Record<string, unknown>).code ===
                        "string"
                        ? ((error.data as Record<string, unknown>)
                            .code as string)
                        : null;
                    const terminalCodeExchangeError =
                      errorCode === "OAUTH_INVALID_STATE" ||
                      errorCode === "OAUTH_PROVIDER_ERROR" ||
                      errorCode === "OAUTH_MISSING_ID_TOKEN" ||
                      errorCode === "OAUTH_INVALID_PROFILE" ||
                      errorCode === "OAUTH_MISSING_VERIFIER" ||
                      errorCode === "INVALID_VERIFIER" ||
                      errorCode === "INVALID_VERIFICATION_CODE";
                    if (!terminalCodeExchangeError) {
                      return {
                        redirect: false,
                        cookies: [],
                        token: currentCookies.token,
                      };
                    }
                    redirectUrl.searchParams.delete("code");
                    const cookies = structuredAuthCookies(
                      {
                        token: currentCookies.token,
                        refreshToken: currentCookies.refreshToken,
                        verifier: null,
                      },
                      host,
                      cookieConfig,
                      cookieNamespace,
                    );
                    return {
                      redirect: true,
                      response: buildRedirectResponse(
                        redirectUrl.toString(),
                        cookies,
                      ),
                    };
                  },
                }),
              ),
            );
          },
          skip: async () => null,
        }),
      );
      const codeExchangeDecision =
        codeExchangeResult !== null
          ? { kind: "done" as const, result: codeExchangeResult }
          : { kind: "continue" as const };
      const maybeCodeExchangeResult = await Fx.run(
        Fx.match(codeExchangeDecision, codeExchangeDecision.kind, {
          done: ({ result }) => result,
          continue: () => null,
        }),
      );
      if (maybeCodeExchangeResult !== null) {
        return maybeCodeExchangeResult;
      }

      // Normal page load — refresh tokens if needed.
      const tokens = await Fx.run(
        Fx.gen(function* () {
          const { token, refreshToken } = currentCookies;

          const isMalformedRefreshToken =
            refreshToken !== null &&
            (refreshToken.trim().length === 0 || refreshToken === "dummy");
          const malformedRefreshTokenDispatch = isMalformedRefreshToken
            ? { kind: "malformed" as const }
            : { kind: "ok" as const };
          const malformedRefreshTokenResult = yield* Fx.match(
            malformedRefreshTokenDispatch,
            malformedRefreshTokenDispatch.kind,
            {
              malformed: () => {
                if (verbose) {
                  console.debug(
                    `${new Date().toISOString()} [convex-auth/server] Refresh token cookie malformed, clearing auth cookies`,
                  );
                }
                return null;
              },
              ok: () => undefined,
            },
          );
          if (malformedRefreshTokenResult !== undefined) {
            return malformedRefreshTokenResult;
          }

          const decodedToken =
            token === null
              ? null
              : yield* Fx.attempt(
                  async () => jwtDecode<DecodedToken>(token),
                  (decoded) => decoded,
                  () => null,
                );
          const issuerDispatch =
            decodedToken?.iss !== undefined &&
            !acceptedIssuers.has(normalizeIssuer(decodedToken.iss))
              ? { kind: "issuerMismatch" as const }
              : { kind: "issuerOk" as const };
          const issuerResult = yield* Fx.match(
            issuerDispatch,
            issuerDispatch.kind,
            {
              issuerMismatch: () => {
                if (verbose) {
                  console.debug(
                    `${new Date().toISOString()} [convex-auth/server] Access token issuer mismatch, clearing auth cookies`,
                  );
                }
                return null;
              },
              issuerOk: () => undefined,
            },
          );
          if (issuerResult !== undefined) {
            return issuerResult;
          }

          const tokenState =
            token === null
              ? refreshToken === null
                ? { kind: "none" as const }
                : { kind: "refreshOnly" as const, refreshToken }
              : refreshToken === null
                ? { kind: "accessOnly" as const, token }
                : { kind: "both" as const, token, refreshToken };

          return yield* Fx.match(tokenState, tokenState.kind, {
            none: () => {
              if (verbose) {
                console.debug(
                  `${new Date().toISOString()} [convex-auth/server] No auth cookies found, skipping refresh`,
                );
              }
              return Fx.succeed(undefined);
            },
            refreshOnly: ({ refreshToken: refreshTokenValue }) => {
              if (verbose) {
                console.debug(
                  `${new Date().toISOString()} [convex-auth/server] Access token cookie missing, attempting refresh-token recovery`,
                );
              }
              return Fx.from({
                ok: async () => {
                  const client = new ConvexHttpClient(convexUrl);
                  const result = (await client.action(signInActionRef, {
                    refreshToken: refreshTokenValue,
                  })) as SignInActionResult;
                  const tokens = await Fx.run(
                    Fx.match(result, result.kind, {
                      signedIn: (signedInResult) =>
                        Fx.succeed(signedInResult.tokens),
                      redirect: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                      started: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                      passkeyOptions: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                      totpRequired: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                      totpSetup: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                      deviceCode: () =>
                        Fx.fatal(
                          new Error(
                            "Invalid `auth:signIn` result for token refresh",
                          ),
                        ),
                    }),
                  );
                  if (verbose) {
                    console.debug(
                      `${new Date().toISOString()} [convex-auth/server] Refreshed tokens, null=${tokens === null}`,
                    );
                  }
                  return tokens;
                },
                err: (error) => error,
              }).pipe(
                Fx.recover((error: unknown) => {
                  console.error(
                    "[convex-auth/server] refresh-token exchange failed",
                    error,
                  );
                  const errorCode =
                    error instanceof ConvexError &&
                    typeof error.data === "object" &&
                    error.data !== null &&
                    typeof (error.data as Record<string, unknown>).code ===
                      "string"
                      ? ((error.data as Record<string, unknown>).code as string)
                      : null;
                  if (errorCode === "INVALID_REFRESH_TOKEN") {
                    if (verbose) {
                      console.debug(
                        `${new Date().toISOString()} [convex-auth/server] Refresh token rejected, clearing auth cookies`,
                      );
                    }
                    return Fx.succeed(
                      null as
                        | { token: string; refreshToken: string }
                        | null
                        | undefined,
                    );
                  }
                  if (verbose) {
                    console.debug(
                      `${new Date().toISOString()} [convex-auth/server] Token refresh failed transiently, keeping current cookies`,
                    );
                  }
                  return Fx.succeed(
                    undefined as
                      | { token: string; refreshToken: string }
                      | null
                      | undefined,
                  );
                }),
              );
            },
            accessOnly: () => {
              const accessOnlyDispatch =
                decodedToken?.exp !== undefined &&
                decodedToken.iss !== undefined &&
                acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
                decodedToken.exp * 1000 > Date.now()
                  ? { kind: "accessValid" as const }
                  : { kind: "accessInvalid" as const };
              return Fx.match(accessOnlyDispatch, accessOnlyDispatch.kind, {
                accessValid: () => {
                  if (verbose) {
                    console.debug(
                      `${new Date().toISOString()} [convex-auth/server] Refresh token cookie missing but access token still valid`,
                    );
                  }
                  return Fx.succeed(undefined);
                },
                accessInvalid: () => {
                  if (verbose) {
                    console.debug(
                      `${new Date().toISOString()} [convex-auth/server] Refresh token cookie missing and access token invalid, clearing`,
                    );
                  }
                  return Fx.succeed(null);
                },
              });
            },
            both: ({ refreshToken: refreshTokenValue }) => {
              const bothDecodeDispatch:
                | { kind: "undecodable" }
                | {
                    kind: "decoded";
                    decodedToken: DecodedToken & {
                      exp: number;
                      iat: number;
                    };
                  } =
                decodedToken?.exp === undefined ||
                decodedToken.iat === undefined
                  ? { kind: "undecodable" as const }
                  : {
                      kind: "decoded" as const,
                      decodedToken: decodedToken as DecodedToken & {
                        exp: number;
                        iat: number;
                      },
                    };
              return Fx.match(bothDecodeDispatch, bothDecodeDispatch.kind, {
                undecodable: () => {
                  if (verbose) {
                    console.debug(
                      `${new Date().toISOString()} [convex-auth/server] Failed to decode access token, attempting refresh-token recovery`,
                    );
                  }
                  return Fx.from({
                    ok: async () => {
                      const client = new ConvexHttpClient(convexUrl);
                      const result = (await client.action(signInActionRef, {
                        refreshToken: refreshTokenValue,
                      })) as SignInActionResult;
                      const tokens = await Fx.run(
                        Fx.match(result, result.kind, {
                          signedIn: (signedInResult) =>
                            Fx.succeed(signedInResult.tokens),
                          redirect: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                          started: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                          passkeyOptions: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                          totpRequired: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                          totpSetup: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                          deviceCode: () =>
                            Fx.fatal(
                              new Error(
                                "Invalid `auth:signIn` result for token refresh",
                              ),
                            ),
                        }),
                      );
                      if (verbose) {
                        console.debug(
                          `${new Date().toISOString()} [convex-auth/server] Refreshed tokens, null=${tokens === null}`,
                        );
                      }
                      return tokens;
                    },
                    err: (error) => error,
                  }).pipe(
                    Fx.recover((error: unknown) => {
                      console.error(
                        "[convex-auth/server] refresh-token exchange failed",
                        error,
                      );
                      const errorCode =
                        error instanceof ConvexError &&
                        typeof error.data === "object" &&
                        error.data !== null &&
                        typeof (error.data as Record<string, unknown>).code ===
                          "string"
                          ? ((error.data as Record<string, unknown>)
                              .code as string)
                          : null;
                      if (errorCode === "INVALID_REFRESH_TOKEN") {
                        if (verbose) {
                          console.debug(
                            `${new Date().toISOString()} [convex-auth/server] Refresh token rejected, clearing auth cookies`,
                          );
                        }
                        return Fx.succeed(
                          null as
                            | { token: string; refreshToken: string }
                            | null
                            | undefined,
                        );
                      }
                      if (verbose) {
                        console.debug(
                          `${new Date().toISOString()} [convex-auth/server] Token refresh failed transiently, keeping current cookies`,
                        );
                      }
                      return Fx.succeed(
                        undefined as
                          | { token: string; refreshToken: string }
                          | null
                          | undefined,
                      );
                    }),
                  );
                },
                decoded: ({ decodedToken: decodedAccessToken }) => {
                  const totalTokenLifetimeMs =
                    decodedAccessToken.exp * 1000 -
                    decodedAccessToken.iat * 1000;
                  const minimumExpiration =
                    Date.now() +
                    Math.min(
                      REQUIRED_TOKEN_LIFETIME_MS,
                      Math.max(
                        MINIMUM_REQUIRED_TOKEN_LIFETIME_MS,
                        totalTokenLifetimeMs / 10,
                      ),
                    );
                  const expirationDispatch =
                    decodedAccessToken.exp * 1000 > minimumExpiration
                      ? { kind: "skipRefresh" as const }
                      : { kind: "refresh" as const };
                  return Fx.match(expirationDispatch, expirationDispatch.kind, {
                    skipRefresh: () => {
                      if (verbose) {
                        console.debug(
                          `${new Date().toISOString()} [convex-auth/server] Token valid long enough, skipping refresh`,
                        );
                      }
                      return Fx.succeed(undefined);
                    },
                    refresh: () =>
                      Fx.from({
                        ok: async () => {
                          const client = new ConvexHttpClient(convexUrl);
                          const result = (await client.action(signInActionRef, {
                            refreshToken: refreshTokenValue,
                          })) as SignInActionResult;
                          const tokens = await Fx.run(
                            Fx.match(result, result.kind, {
                              signedIn: (signedInResult) =>
                                Fx.succeed(signedInResult.tokens),
                              redirect: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                              started: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                              passkeyOptions: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                              totpRequired: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                              totpSetup: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                              deviceCode: () =>
                                Fx.fatal(
                                  new Error(
                                    "Invalid `auth:signIn` result for token refresh",
                                  ),
                                ),
                            }),
                          );
                          if (verbose) {
                            console.debug(
                              `${new Date().toISOString()} [convex-auth/server] Refreshed tokens, null=${tokens === null}`,
                            );
                          }
                          return tokens;
                        },
                        err: (error) => error,
                      }).pipe(
                        Fx.recover((error: unknown) => {
                          console.error(
                            "[convex-auth/server] refresh-token exchange failed",
                            error,
                          );
                          const errorCode =
                            error instanceof ConvexError &&
                            typeof error.data === "object" &&
                            error.data !== null &&
                            typeof (error.data as Record<string, unknown>)
                              .code === "string"
                              ? ((error.data as Record<string, unknown>)
                                  .code as string)
                              : null;
                          if (errorCode === "INVALID_REFRESH_TOKEN") {
                            if (verbose) {
                              console.debug(
                                `${new Date().toISOString()} [convex-auth/server] Refresh token rejected, clearing auth cookies`,
                              );
                            }
                            return Fx.succeed(
                              null as
                                | { token: string; refreshToken: string }
                                | null
                                | undefined,
                            );
                          }
                          if (verbose) {
                            console.debug(
                              `${new Date().toISOString()} [convex-auth/server] Token refresh failed transiently, keeping current cookies`,
                            );
                          }
                          return Fx.succeed(
                            undefined as
                              | { token: string; refreshToken: string }
                              | null
                              | undefined,
                          );
                        }),
                      ),
                  });
                },
              });
            },
          });
        }),
      );
      if (tokens === undefined) {
        return { redirect: false, cookies: [], token: currentToken };
      }

      return {
        redirect: false,
        cookies: structuredAuthCookies(
          {
            token: tokens?.token ?? null,
            refreshToken: tokens?.refreshToken ?? null,
            verifier: null,
          },
          host,
          cookieConfig,
          cookieNamespace,
        ),
        token: tokens?.token ?? null,
      };
    },
  };
}
