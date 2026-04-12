import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { parse, serialize } from "cookie";
import { Cause, Effect, Exit, Match } from "effect";
import { jwtDecode } from "jwt-decode";

import type {
  SignInAction,
  SignInActionResult,
  SignOutAction,
} from "./runtime";
import type { SignInParams } from "./payloads";
import type { Tokens } from "./types";
import { log } from "./log";
import { isLocalHost } from "./url";

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

type ProxyActionBody = {
  action?: unknown;
  args?: unknown;
};

type ProxySignInArgs = {
  refreshToken?: string;
  verifier?: string;
  params?: SignInParams;
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
const JSON_HEADERS = { "Content-Type": "application/json" };

type DecodedToken = { exp?: number; iat?: number; iss?: string };

function runBoundary<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromiseExit(effect).then(
    Exit.match({
      onSuccess: (value) => value,
      onFailure: (cause) => Promise.reject(Cause.squash(cause)),
    }),
  );
}

function decodeToken(token: string): Effect.Effect<DecodedToken | null> {
  return Effect.try({
    try: () => jwtDecode<DecodedToken>(token),
    catch: () => null,
  }).pipe(Effect.catch(() => Effect.succeed(null)));
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function appendCookieHeaders(response: Response, values: string[]): Response {
  for (const value of values) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}

function getConvexErrorCode(error: unknown): string | null {
  return error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    typeof (error.data as Record<string, unknown>).code === "string"
    ? ((error.data as Record<string, unknown>).code as string)
    : null;
}

function getProxyErrorBody(error: unknown) {
  return error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data
    ? {
        error:
          (error.data as { message?: string }).message ?? String(error),
        authError: error.data,
      }
    : {
        error: error instanceof Error ? error.message : String(error),
      };
}

function extractSignedInTokens(
  result: SignInActionResult,
  context: string,
): Effect.Effect<Tokens | null, Error> {
  return Match.value(result).pipe(
    Match.when({ kind: "signedIn" }, ({ tokens }) => Effect.succeed(tokens)),
    Match.orElse(() =>
      Effect.fail(
        new Error(`Invalid \`auth:signIn\` result for ${context}`),
      ),
    ),
  );
}

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
      return runBoundary(
        Effect.gen(function* () {
          const token = parseAuthCookies(
            request.headers.get("cookie"),
            request.headers.get("host") ?? new URL(request.url).host,
            cookieNamespace,
          ).token;
          if (token === null) {
            return false;
          }
          const decodedToken = yield* decodeToken(token);
          return (
            decodedToken?.exp !== undefined &&
            decodedToken.iss !== undefined &&
            acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
            decodedToken.exp * 1000 > Date.now()
          );
        }).pipe(Effect.withSpan("convex-auth.ssr.refresh")),
      );
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
      const createClient = (token?: string | null) => {
        const client = new ConvexHttpClient(convexUrl);
        if (token !== null && token !== undefined) {
          client.setAuth(token);
        }
        return client;
      };
      const runSignIn = (
        client: ConvexHttpClient,
        args: ProxySignInArgs,
      ) =>
        Effect.tryPromise({
          try: () =>
            client.action(signInActionRef, args) as Promise<SignInActionResult>,
          catch: (error) => error,
        });
      const runSignOut = (token?: string | null) =>
        Effect.tryPromise({
          try: () => createClient(token).action(signOutActionRef),
          catch: (error) => error,
        });
      const hydrateProxySignInClient = (
        currentCookies: AuthCookies,
        args: ProxySignInArgs,
      ) =>
        Effect.gen(function* () {
          const client = createClient();
          const requestParams =
            typeof args.params === "object" && args.params !== null
              ? args.params
              : undefined;
          const shouldAttachCurrentIdentity =
            args.refreshToken === undefined && requestParams?.code === undefined;

          if (!shouldAttachCurrentIdentity) {
            return { client, cookies: currentCookies };
          }

          const currentToken = currentCookies.token;
          const decodedToken =
            currentToken === null ? null : yield* decodeToken(currentToken);
          const hasValidCurrentToken =
            currentToken !== null &&
            decodedToken?.exp !== undefined &&
            decodedToken.iss !== undefined &&
            acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
            decodedToken.exp * 1000 > Date.now();

          if (hasValidCurrentToken) {
            yield* Effect.sync(() => {
              client.setAuth(currentToken);
            });
            return { client, cookies: currentCookies };
          }

          if (currentCookies.refreshToken === null) {
            return { client, cookies: currentCookies };
          }

          const refreshedTokens = yield* runSignIn(createClient(), {
            refreshToken: currentCookies.refreshToken,
          }).pipe(
            Effect.flatMap((result) =>
              extractSignedInTokens(result, "proxy sign-in auth hydration"),
            ),
            Effect.catch(() => Effect.succeed<Tokens | null>(null)),
          );

          if (refreshedTokens === null) {
            return { client, cookies: currentCookies };
          }

          yield* Effect.sync(() => {
            client.setAuth(refreshedTokens.token);
          });

          return {
            client,
            cookies: {
              token: refreshedTokens.token,
              refreshToken: refreshedTokens.refreshToken,
              verifier: currentCookies.verifier,
            } satisfies AuthCookies,
          };
        });
      const toSignInProxyResponse = (
        result: SignInActionResult,
        args: ProxySignInArgs,
        currentCookies: AuthCookies,
        host: string,
      ): Effect.Effect<Response> =>
        Match.value(result).pipe(
          Match.when({ kind: "redirect" }, (redirectResult) =>
            Effect.sync(() =>
              appendCookieHeaders(
                jsonResponse({
                  kind: "redirect",
                  redirect: redirectResult.redirect,
                  verifier: redirectResult.verifier,
                }),
                serializeAuthCookies(
                  {
                    ...currentCookies,
                    verifier: redirectResult.verifier,
                  },
                  host,
                  cookieConfig,
                  cookieNamespace,
                ),
              ),
            ),
          ),
          Match.when({ kind: "signedIn" }, (signedInResult) =>
            Effect.sync(() => {
              const nextCookies =
                signedInResult.tokens === null
                  ? {
                      token: currentCookies.token,
                      refreshToken: currentCookies.refreshToken,
                      verifier: null,
                    }
                  : {
                      token: signedInResult.tokens.token,
                      refreshToken: signedInResult.tokens.refreshToken,
                      verifier: null,
                    };
              return appendCookieHeaders(
                jsonResponse({
                  kind: "signedIn",
                  tokens:
                    signedInResult.tokens === null
                      ? null
                      : {
                          token: signedInResult.tokens.token,
                          refreshToken: "dummy",
                        },
                }),
                serializeAuthCookies(
                  nextCookies,
                  host,
                  cookieConfig,
                  cookieNamespace,
                ),
              );
            }),
          ),
          Match.when({ kind: "started" }, (startedResult) =>
            Effect.succeed(jsonResponse(startedResult)),
          ),
          Match.when({ kind: "passkeyOptions" }, (passkeyOptionsResult) =>
            Effect.succeed(jsonResponse(passkeyOptionsResult)),
          ),
          Match.when({ kind: "totpRequired" }, (totpRequiredResult) =>
            Effect.succeed(jsonResponse(totpRequiredResult)),
          ),
          Match.when({ kind: "totpSetup" }, (totpSetupResult) =>
            Effect.succeed(jsonResponse(totpSetupResult)),
          ),
          Match.when({ kind: "deviceCode" }, (deviceCodeResult) =>
            Effect.succeed(jsonResponse(deviceCodeResult)),
          ),
          Match.exhaustive,
        ).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              const response = jsonResponse(getProxyErrorBody(error), 400);
              const clearSession =
                args.refreshToken !== undefined &&
                getConvexErrorCode(error) === "INVALID_REFRESH_TOKEN";
              return appendCookieHeaders(
                response,
                serializeAuthCookies(
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
                ),
              );
            }),
          ),
        );

      return runBoundary(
        Effect.gen(function* () {
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

          const validationErrorResponse = Match.value(requestDispatch).pipe(
            Match.when({ kind: "invalidRoute" }, () =>
              new Response("Invalid route", { status: 404 }),
            ),
            Match.when({ kind: "invalidMethod" }, () =>
              new Response("Invalid method", { status: 405 }),
            ),
            Match.when({ kind: "invalidOrigin" }, () =>
              new Response("Invalid origin", { status: 403 }),
            ),
            Match.when({ kind: "valid" }, () => null),
            Match.exhaustive,
          );
          if (validationErrorResponse !== null) {
            return validationErrorResponse;
          }

          const body = yield* Effect.tryPromise({
            try: () => request.json(),
            catch: () => null,
          }).pipe(
            Effect.catch(() => Effect.succeed(null)),
            Effect.map((parsed) =>
              typeof parsed === "object" && parsed !== null
                ? (parsed as ProxyActionBody)
                : null,
            ),
          );
          if (body === null) {
            return new Response("Invalid request body", { status: 400 });
          }

          const action = body.action;
          const args: ProxySignInArgs =
            typeof body.args === "object" && body.args !== null
              ? { ...(body.args as Record<string, unknown>) }
              : {};
          if (args.refreshToken === null) {
            args.refreshToken = undefined;
          }
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

          return yield* Match.value(actionDispatch).pipe(
            Match.when({ action: "sessionStart" }, () =>
              Effect.gen(function* () {
                const refreshResponse = yield* Match.value({
                  kind:
                    args.refreshToken === undefined
                      ? "passthrough"
                      : currentCookies.refreshToken === null
                        ? "refreshRequestedWithoutCookie"
                        : "hydrateRefreshFromCookie",
                  refreshToken: currentCookies.refreshToken,
                } as const).pipe(
                  Match.when({ kind: "passthrough" }, () => Effect.succeed(null)),
                  Match.when(
                    { kind: "hydrateRefreshFromCookie" },
                    ({ refreshToken }) =>
                      Effect.sync(() => {
                        args.refreshToken = refreshToken ?? undefined;
                        return null;
                      }),
                  ),
                  Match.when({ kind: "refreshRequestedWithoutCookie" }, () =>
                    Effect.gen(function* () {
                      const currentToken = currentCookies.token;
                      const decodedToken =
                        currentToken === null
                          ? null
                          : yield* decodeToken(currentToken);
                      return Match.value(
                        currentToken !== null &&
                          decodedToken?.exp !== undefined &&
                          decodedToken.iss !== undefined &&
                          acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
                          decodedToken.exp * 1000 > Date.now()
                          ? { kind: "validToken" as const, token: currentToken }
                          : { kind: "missingToken" as const },
                      ).pipe(
                        Match.when({ kind: "validToken" }, ({ token }) =>
                          jsonResponse({
                            tokens: { token, refreshToken: "dummy" },
                          }),
                        ),
                        Match.when({ kind: "missingToken" }, () =>
                          jsonResponse({ tokens: null }),
                        ),
                        Match.exhaustive,
                      );
                    }),
                  ),
                  Match.exhaustive,
                );
                if (refreshResponse !== null) {
                  return refreshResponse;
                }

                const {
                  client,
                  cookies: effectiveCookies,
                } = yield* hydrateProxySignInClient(currentCookies, args);

                return yield* runSignIn(client, args).pipe(
                  Effect.flatMap((result) =>
                    toSignInProxyResponse(result, args, effectiveCookies, host),
                  ),
                  Effect.catch((error) =>
                    Effect.succeed(
                      appendCookieHeaders(
                        jsonResponse(getProxyErrorBody(error), 400),
                        serializeAuthCookies(
                          {
                            token: effectiveCookies.token,
                            refreshToken: effectiveCookies.refreshToken,
                            verifier: null,
                          },
                          host,
                          cookieConfig,
                          cookieNamespace,
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
            Match.when({ action: "sessionStop" }, () =>
              Effect.gen(function* () {
                yield* runSignOut(currentCookies.token).pipe(
                  Effect.catch((error) =>
                    Effect.gen(function* () {
                      yield* Effect.sync(() => {
                        log(
                          "ERROR",
                          "[convex-auth/server] proxy sign-out failed",
                          error,
                        );
                      });
                      yield* Match.value(currentCookies.refreshToken).pipe(
                        Match.when(null, () => Effect.void),
                        Match.orElse((refreshToken) =>
                          Effect.gen(function* () {
                            yield* runSignIn(createClient(), { refreshToken }).pipe(
                              Effect.flatMap((refreshed) =>
                                extractSignedInTokens(
                                  refreshed,
                                  "sign-out fallback refresh",
                                ),
                              ),
                              Effect.flatMap((refreshedTokens) =>
                                refreshedTokens !== null
                                  ? runSignOut(refreshedTokens.token)
                                  : Effect.void,
                              ),
                              Effect.catch((fallbackError) =>
                                Effect.sync(() => {
                                  log(
                                    "ERROR",
                                    "[convex-auth/server] proxy sign-out fallback failed",
                                    fallbackError,
                                  );
                                }),
                              ),
                            );
                          }),
                        ),
                      );
                    }),
                  ),
                );

                return appendCookieHeaders(
                  jsonResponse(null),
                  serializeAuthCookies(
                    {
                      token: null,
                      refreshToken: null,
                      verifier: null,
                    },
                    host,
                    cookieConfig,
                    cookieNamespace,
                  ),
                );
              }),
            ),
            Match.exhaustive,
          );
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
      const createClient = () => new ConvexHttpClient(convexUrl);
      const logVerbose = (message: string) =>
        verbose
          ? Effect.sync(() => {
              log(
                "DEBUG",
                `${new Date().toISOString()} [convex-auth/server] ${message}`,
              );
            })
          : Effect.void;
      const refreshWithToken = (
        refreshToken: string,
        ): Effect.Effect<Tokens | null | undefined> =>
          Effect.tryPromise({
            try: () =>
              createClient().action(signInActionRef, {
                refreshToken,
              }) as Promise<SignInActionResult>,
            catch: (error) => error,
          }).pipe(
          Effect.flatMap((result) =>
            extractSignedInTokens(result, "token refresh"),
          ),
          Effect.tap((tokens) =>
            logVerbose(`Refreshed tokens, null=${tokens === null}`),
          ),
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* Effect.sync(() => {
                log(
                  "ERROR",
                  "[convex-auth/server] refresh-token exchange failed",
                  error,
                );
              });
              if (getConvexErrorCode(error) === "INVALID_REFRESH_TOKEN") {
                yield* logVerbose("Refresh token rejected, clearing auth cookies");
                return null;
              }
              yield* logVerbose(
                "Token refresh failed transiently, keeping current cookies",
              );
              return undefined;
            }),
          ),
        );

      return runBoundary(
        Effect.gen(function* () {
          const host = request.headers.get("host") ?? new URL(request.url).host;
          const currentCookies = parseAuthCookies(
            request.headers.get("cookie"),
            host,
            cookieNamespace,
          );
          const currentToken = currentCookies.token;

          const originHeader = request.headers.get("origin");
          const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
          const protocol =
            forwardedProtoHeader !== null
              ? (() => {
                  const forwardedProto = forwardedProtoHeader
                    .split(",")[0]
                    ?.trim();
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
          if (corsRequest) {
            return {
              redirect: false,
              cookies: [],
              token: null,
            } satisfies RefreshResult;
          }

          const requestUrl = new URL(request.url);
          const code = requestUrl.searchParams.get("code");
          const shouldHandleCodeOption = options.shouldHandleCode;
          const shouldHandleCode =
            shouldHandleCodeOption === undefined
              ? true
              : typeof shouldHandleCodeOption === "function"
                ? yield* Effect.sync(() => shouldHandleCodeOption(request)).pipe(
                    Effect.flatMap((result) =>
                      typeof result === "boolean"
                        ? Effect.succeed(result)
                        : Effect.promise(() => result),
                    ),
                  )
                : shouldHandleCodeOption;

          const codeExchangeResult = yield* Match.value(
            code !== null &&
              request.method === "GET" &&
              request.headers.get("accept")?.includes("text/html") &&
              shouldHandleCode
              ? { kind: "exchange" as const, code }
              : { kind: "skip" as const },
          ).pipe(
            Match.when({ kind: "skip" }, () => Effect.succeed(null)),
            Match.when({ kind: "exchange" }, ({ code: verificationCode }) => {
              const redirectUrl = new URL(requestUrl.toString());
              return Effect.gen(function* () {
                const result = yield* Effect.tryPromise({
                  try: () =>
                    createClient().action(signInActionRef, {
                      params: { code: verificationCode },
                      verifier: currentCookies.verifier ?? undefined,
                    }) as Promise<SignInActionResult>,
                  catch: (error) => error,
                }).pipe(
                  Effect.flatMap((value) =>
                    extractSignedInTokens(value, "code exchange"),
                  ),
                );
                redirectUrl.searchParams.delete("code");
                const cookies = structuredAuthCookies(
                  {
                    token: result?.token ?? null,
                    refreshToken: result?.refreshToken ?? null,
                    verifier: null,
                  },
                  host,
                  cookieConfig,
                  cookieNamespace,
                );
                return {
                  redirect: true,
                  response: buildRedirectResponse(redirectUrl.toString(), cookies),
                } satisfies RefreshResult;
              }).pipe(
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    yield* Effect.sync(() => {
                      log(
                        "ERROR",
                        "[convex-auth/server] code exchange failed",
                        error,
                      );
                    });
                    const terminalCodeExchangeError = [
                      "OAUTH_INVALID_STATE",
                      "OAUTH_PROVIDER_ERROR",
                      "OAUTH_MISSING_ID_TOKEN",
                      "OAUTH_INVALID_PROFILE",
                      "OAUTH_MISSING_VERIFIER",
                      "INVALID_VERIFIER",
                      "INVALID_VERIFICATION_CODE",
                    ].includes(getConvexErrorCode(error) ?? "");
                    if (!terminalCodeExchangeError) {
                      return {
                        redirect: false,
                        cookies: [],
                        token: currentCookies.token,
                      } satisfies RefreshResult;
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
                    } satisfies RefreshResult;
                  }),
                ),
              );
            }),
            Match.exhaustive,
          );
          if (codeExchangeResult !== null) {
            return codeExchangeResult;
          }

          const { token, refreshToken } = currentCookies;
          const isMalformedRefreshToken =
            refreshToken !== null &&
            (refreshToken.trim().length === 0 || refreshToken === "dummy");
          if (isMalformedRefreshToken) {
            yield* logVerbose("Refresh token cookie malformed, clearing auth cookies");
            return {
              redirect: false,
              cookies: structuredAuthCookies(
                { token: null, refreshToken: null, verifier: null },
                host,
                cookieConfig,
                cookieNamespace,
              ),
              token: null,
            } satisfies RefreshResult;
          }

          const decodedToken =
            token === null ? null : yield* decodeToken(token);
          if (
            decodedToken?.iss !== undefined &&
            !acceptedIssuers.has(normalizeIssuer(decodedToken.iss))
          ) {
            yield* logVerbose("Access token issuer mismatch, clearing auth cookies");
            return {
              redirect: false,
              cookies: structuredAuthCookies(
                { token: null, refreshToken: null, verifier: null },
                host,
                cookieConfig,
                cookieNamespace,
              ),
              token: null,
            } satisfies RefreshResult;
          }

          const tokens = yield* Match.value(
            token === null
              ? refreshToken === null
                ? { kind: "none" as const }
                : { kind: "refreshOnly" as const, refreshToken }
              : refreshToken === null
                ? { kind: "accessOnly" as const, token }
                : { kind: "both" as const, token, refreshToken },
          ).pipe(
            Match.when({ kind: "none" }, () =>
              logVerbose("No auth cookies found, skipping refresh").pipe(
                Effect.as(undefined),
              ),
            ),
            Match.when({ kind: "refreshOnly" }, ({ refreshToken }) =>
              logVerbose(
                "Access token cookie missing, attempting refresh-token recovery",
              ).pipe(Effect.andThen(() => refreshWithToken(refreshToken))),
            ),
            Match.when({ kind: "accessOnly" }, () =>
              (decodedToken?.exp !== undefined &&
              decodedToken.iss !== undefined &&
              acceptedIssuers.has(normalizeIssuer(decodedToken.iss)) &&
              decodedToken.exp * 1000 > Date.now()
                ? logVerbose(
                    "Refresh token cookie missing but access token still valid",
                  ).pipe(Effect.as(undefined))
                : logVerbose(
                    "Refresh token cookie missing and access token invalid, clearing",
                  ).pipe(Effect.as(null))),
            ),
            Match.when({ kind: "both" }, ({ refreshToken }) =>
              Match.value(
                decodedToken?.exp === undefined || decodedToken.iat === undefined
                  ? { kind: "undecodable" as const }
                  : {
                      kind: "decoded" as const,
                      decodedToken: decodedToken as DecodedToken & {
                        exp: number;
                        iat: number;
                      },
                    },
              ).pipe(
                Match.when({ kind: "undecodable" }, () =>
                  logVerbose(
                    "Failed to decode access token, attempting refresh-token recovery",
                  ).pipe(Effect.andThen(() => refreshWithToken(refreshToken))),
                ),
                Match.when({ kind: "decoded" }, ({ decodedToken }) => {
                  const totalTokenLifetimeMs =
                    decodedToken.exp * 1000 - decodedToken.iat * 1000;
                  const minimumExpiration =
                    Date.now() +
                    Math.min(
                      REQUIRED_TOKEN_LIFETIME_MS,
                      Math.max(
                        MINIMUM_REQUIRED_TOKEN_LIFETIME_MS,
                        totalTokenLifetimeMs / 10,
                      ),
                    );
                  return decodedToken.exp * 1000 > minimumExpiration
                    ? logVerbose("Token valid long enough, skipping refresh").pipe(
                        Effect.as(undefined),
                      )
                    : refreshWithToken(refreshToken);
                }),
                Match.exhaustive,
              ),
            ),
            Match.exhaustive,
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
          } satisfies RefreshResult;
        }),
      );
    },
  };
}
