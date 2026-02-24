import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { jwtDecode } from "jwt-decode";
import { parse, serialize } from "cookie";
import type {
  SignInAction,
  SignOutAction,
} from "./implementation/index";
import { isLocalHost } from "./utils";

const signInActionRef: SignInAction = makeFunctionReference(
  "auth/session:start",
);
const signOutActionRef: SignOutAction = makeFunctionReference(
  "auth/session:stop",
);

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
  accepted_issuers?: string[];
  /**
   * Path the client POSTs auth actions to. Defaults to `"/api/auth"`.
   * Must match the `proxy_path` option on the client.
   */
  api_route?: string;
  /** Cookie `maxAge` in seconds, or `null` for session cookies. */
  cookie_max_age?: number | null;
  /** Enable verbose debug logging for token refresh and cookie operations. */
  verbose?: boolean;
  /**
   * Optional namespace for auth cookie names.
   *
   * Use this to isolate auth cookies between multiple local apps on the same host.
   * If omitted, a deterministic deployment-scoped namespace is derived from `url`.
   */
  cookie_namespace?: string;
  /**
   * Control whether `refresh()` handles OAuth `?code=` query parameters.
   *
   * - `true` (default): always exchange the code on GET requests with `text/html` accept.
   * - `false`: never exchange — useful when only the client handles codes.
   * - A function: called with the `Request` for per-request decisions.
   */
  should_handle_code?:
    | ((request: Request) => boolean | Promise<boolean>)
    | boolean;
};

export type RefreshResult = {
  /** Structured cookies to set on the response. */
  cookies: AuthCookie[];
  /** URL to redirect to (set after OAuth code exchange). */
  redirect?: string;
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
export function auth_cookie_names(host?: string, cookieNamespace?: string | null) {
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
export function parse_auth_cookies(
  cookieHeader: string | null | undefined,
  host?: string,
  cookieNamespace?: string | null,
): AuthCookies {
  const names = auth_cookie_names(host, cookieNamespace);
  const legacyNames = auth_cookie_names(host);
  const parsed = parse(cookieHeader ?? "");
  const readCookie = (name: string, legacyName: string) => {
    const primary = parsed[name];
    if (primary !== undefined) {
      return primary;
    }
    if (legacyName !== name) {
      const legacy = parsed[legacyName];
      if (legacy !== undefined) {
        return legacy;
      }
    }
    return null;
  };
  return {
    token: readCookie(names.token, legacyNames.token),
    refreshToken: readCookie(names.refreshToken, legacyNames.refreshToken),
    verifier: readCookie(names.verifier, legacyNames.verifier),
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
export function serialize_auth_cookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
) {
  const names = auth_cookie_names(host, cookieNamespace);
  const legacyNames = auth_cookie_names(host);
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
  if (legacyNames.token !== names.token) {
    serialized.push(
      serialize(legacyNames.token, "", {
        ...base,
        maxAge: 0,
        expires: new Date(0),
      }),
      serialize(legacyNames.refreshToken, "", {
        ...base,
        maxAge: 0,
        expires: new Date(0),
      }),
      serialize(legacyNames.verifier, "", {
        ...base,
        maxAge: 0,
        expires: new Date(0),
      }),
    );
  }
  return serialized;
}

/**
 * Build structured cookie objects for any SSR framework.
 *
 * Use with SvelteKit's `event.cookies.set()`, TanStack Start's `setCookie()`,
 * Next.js's `cookies().set()`, or any other framework cookie API.
 */
export function structured_auth_cookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
  cookieNamespace?: string | null,
): AuthCookie[] {
  const names = auth_cookie_names(host, cookieNamespace);
  const legacyNames = auth_cookie_names(host);
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

  if (legacyNames.token !== names.token) {
    structured.push(
      {
        name: legacyNames.token,
        value: "",
        options: {
          ...base,
          maxAge: 0,
          expires: new Date(0),
        },
      },
      {
        name: legacyNames.refreshToken,
        value: "",
        options: {
          ...base,
          maxAge: 0,
          expires: new Date(0),
        },
      },
      {
        name: legacyNames.verifier,
        value: "",
        options: {
          ...base,
          maxAge: 0,
          expires: new Date(0),
        },
      },
    );
  }

  return structured;
}

/**
 * Check whether a request pathname matches the auth proxy route.
 *
 * Handles trailing-slash ambiguity: both `/api/auth` and `/api/auth/`
 * match regardless of how `api_route` is configured.
 *
 * @param pathname - The request URL pathname.
 * @param api_route - The configured proxy route (e.g. `"/api/auth"`).
 * @returns `true` when the pathname matches the proxy route.
 */
export function should_proxy_auth_action(pathname: string, api_route: string) {
  if (api_route.endsWith("/")) {
    return pathname === api_route || pathname === api_route.slice(0, -1);
  }
  return pathname === api_route || pathname === `${api_route}/`;
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

function deriveCookieNamespaceFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const raw = `${parsed.hostname}${parsed.pathname}`;
    const normalized = normalizeCookieNamespace(raw);
    return normalized ?? DERIVED_COOKIE_NAMESPACE_FALLBACK;
  } catch {
    return DERIVED_COOKIE_NAMESPACE_FALLBACK;
  }
}

function normalizeIssuer(value: string) {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function convexSiteIssuerFromCloudUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.endsWith(".convex.cloud")) {
      return null;
    }
    parsed.hostname =
      parsed.hostname.slice(0, -".convex.cloud".length) + ".convex.site";
    return normalizeIssuer(parsed.toString());
  } catch {
    return null;
  }
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
 * if (should_proxy_auth_action(url.pathname, '/api/auth')) {
 *   return auth.proxy(request);
 * }
 * ```
 */
export function server(options: ServerOptions) {
  const convexUrl = options.url;
  const apiRoute = options.api_route ?? "/api/auth";
  const cookieConfig = { maxAge: options.cookie_max_age ?? null };
  const verbose = options.verbose ?? false;
  const cookieNamespace =
    normalizeCookieNamespace(options.cookie_namespace) ??
    deriveCookieNamespaceFromUrl(convexUrl);
  const acceptedIssuers = new Set(
    (options.accepted_issuers ?? defaultAcceptedIssuersForUrl(convexUrl))
      .map(normalizeIssuer)
      .filter((issuer) => issuer.length > 0),
  );

  const logVerbose = (message: string) => {
    if (!verbose) {
      return;
    }
    console.debug(
      `${new Date().toISOString()} [convex-auth/server] ${message}`,
    );
  };

  const cookieHost = (request: Request) => {
    return request.headers.get("host") ?? new URL(request.url).host;
  };

  const requestProtocol = (request: Request) => {
    const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
    if (forwardedProtoHeader !== null) {
      const forwardedProto = forwardedProtoHeader.split(",")[0]?.trim();
      if (forwardedProto !== undefined && forwardedProto.length > 0) {
        return forwardedProto.endsWith(":")
          ? forwardedProto
          : `${forwardedProto}:`;
      }
    }
    return new URL(request.url).protocol;
  };

  const normalizeHost = (host: string, protocol: string) => {
    try {
      return new URL(`${protocol}//${host}`).host;
    } catch {
      return host;
    }
  };

  const parseRequestCookies = (request: Request) => {
    return parse_auth_cookies(
      request.headers.get("cookie"),
      cookieHost(request),
      cookieNamespace,
    );
  };

  const attachCookies = (response: Response, cookies: string[]) => {
    for (const value of cookies) {
      response.headers.append("Set-Cookie", value);
    }
    return response;
  };

  const jsonResponse = (body: unknown, status = 200) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const isCorsRequest = (request: Request) => {
    const originHeader = request.headers.get("origin");
    if (originHeader === null) {
      return false;
    }
    const protocol = requestProtocol(request);
    const host = normalizeHost(cookieHost(request), protocol);
    let originUrl: URL;
    try {
      originUrl = new URL(originHeader);
    } catch {
      return true;
    }
    return (
      originUrl.host !== host ||
      originUrl.protocol !== protocol
    );
  };

  const authErrorCode = (error: unknown): string | null => {
    if (!(error instanceof ConvexError)) {
      return null;
    }
    if (typeof error.data !== "object" || error.data === null) {
      return null;
    }
    const code = (error.data as Record<string, unknown>).code;
    return typeof code === "string" ? code : null;
  };

  const shouldClearSessionForRefreshError = (error: unknown) => {
    return authErrorCode(error) === "INVALID_REFRESH_TOKEN";
  };

  const isTerminalCodeExchangeError = (error: unknown) => {
    const code = authErrorCode(error);
    if (code === null) {
      return false;
    }
    return (
      code === "OAUTH_INVALID_STATE" ||
      code === "OAUTH_PROVIDER_ERROR" ||
      code === "OAUTH_MISSING_ID_TOKEN" ||
      code === "OAUTH_INVALID_PROFILE" ||
      code === "OAUTH_MISSING_VERIFIER" ||
      code === "INVALID_VERIFIER" ||
      code === "INVALID_VERIFICATION_CODE"
    );
  };

  const decodeToken = (token: string): DecodedToken | null => {
    try {
      return jwtDecode<DecodedToken>(token);
    } catch {
      return null;
    }
  };

  const issuerMatches = (issuer: string) => {
    return acceptedIssuers.has(normalizeIssuer(issuer));
  };

  const convexClient = (token?: string | null) => {
    const client = new ConvexHttpClient(convexUrl);
    if (token !== undefined && token !== null) {
      client.setAuth(token);
    }
    return client;
  };

  const refreshTokens = async (
    request: Request,
  ): Promise<{ token: string; refreshToken: string } | null | undefined> => {
    const cookies = parseRequestCookies(request);
    const { token, refreshToken } = cookies;

    const isMalformedRefreshToken =
      refreshToken !== null &&
      (refreshToken.trim().length === 0 || refreshToken === "dummy");

    if (isMalformedRefreshToken) {
      logVerbose("Refresh token cookie malformed, clearing auth cookies");
      return null;
    }

    const decodedToken = token === null ? null : decodeToken(token);
    if (
      decodedToken?.iss !== undefined &&
      !issuerMatches(decodedToken.iss)
    ) {
      logVerbose("Access token issuer mismatch, clearing auth cookies");
      return null;
    }

    const attemptRefreshWithToken = async (
      refreshTokenValue: string,
    ): Promise<{ token: string; refreshToken: string } | null | undefined> => {
      try {
        const result = await convexClient().action(
          signInActionRef,
          {
            refreshToken: refreshTokenValue,
          },
        );
        if (result.tokens === undefined) {
          throw new Error(
            "Invalid `auth/session:start` result for token refresh",
          );
        }
        logVerbose(`Refreshed tokens, null=${result.tokens === null}`);
        return result.tokens;
      } catch (error) {
        console.error(error);
        if (shouldClearSessionForRefreshError(error)) {
          logVerbose("Refresh token rejected, clearing auth cookies");
          return null;
        }
        logVerbose("Token refresh failed transiently, keeping current cookies");
        return undefined;
      }
    };

    if (refreshToken === null && token === null) {
      logVerbose("No auth cookies found, skipping refresh");
      return undefined;
    }

    if (refreshToken !== null && token === null) {
      logVerbose("Access token cookie missing, attempting refresh-token recovery");
      return await attemptRefreshWithToken(refreshToken);
    }

    if (refreshToken === null && token !== null) {
      if (
        decodedToken?.exp !== undefined &&
        decodedToken.iss !== undefined &&
        issuerMatches(decodedToken.iss) &&
        decodedToken.exp * 1000 > Date.now()
      ) {
        logVerbose("Refresh token cookie missing but access token still valid");
        return undefined;
      }
      logVerbose("Refresh token cookie missing and access token invalid, clearing");
      return null;
    }

    if (refreshToken === null || token === null) {
      return undefined;
    }

    if (decodedToken?.exp === undefined || decodedToken.iat === undefined) {
      logVerbose("Failed to decode access token, attempting refresh-token recovery");
      return await attemptRefreshWithToken(refreshToken);
    }
    const totalTokenLifetimeMs = decodedToken.exp * 1000 - decodedToken.iat * 1000;
    const minimumExpiration =
      Date.now() +
      Math.min(
        REQUIRED_TOKEN_LIFETIME_MS,
        Math.max(MINIMUM_REQUIRED_TOKEN_LIFETIME_MS, totalTokenLifetimeMs / 10),
      );
    if (decodedToken.exp * 1000 > minimumExpiration) {
      logVerbose("Token valid long enough, skipping refresh");
      return undefined;
    }

    return await attemptRefreshWithToken(refreshToken);
  };

  return {
    /**
     * Read the JWT from the request cookies without any validation.
     *
     * @param request - The incoming HTTP request.
     * @returns The raw JWT string, or `null` when no token cookie exists.
     */
    token(request: Request): string | null {
      return parseRequestCookies(request).token;
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
      const token = parseRequestCookies(request).token;
      if (token === null) {
        return false;
      }
      const decodedToken = decodeToken(token);
      if (decodedToken?.exp === undefined || decodedToken.iss === undefined) {
        return false;
      }
      if (!issuerMatches(decodedToken.iss)) {
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
      if (!should_proxy_auth_action(requestUrl.pathname, apiRoute)) {
        return new Response("Invalid route", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Invalid method", { status: 405 });
      }
      if (isCorsRequest(request)) {
        return new Response("Invalid origin", { status: 403 });
      }

      let body: Record<string, unknown>;
      try {
        const parsed = await request.json();
        if (typeof parsed !== "object" || parsed === null) {
          return new Response("Invalid request body", { status: 400 });
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      const action = body.action as string;
      const args =
        typeof body.args === "object" && body.args !== null
          ? (body.args as Record<string, any>)
          : {};

      if (action !== "auth/session:start" && action !== "auth/session:stop") {
        return new Response("Invalid action", { status: 400 });
      }

      const currentCookies = parseRequestCookies(request);
      const host = cookieHost(request);

      if (action === "auth/session:start") {
        if (args.refreshToken !== undefined) {
          if (currentCookies.refreshToken === null) {
            const decodedToken =
              currentCookies.token === null
                ? null
                : decodeToken(currentCookies.token);
            if (
              currentCookies.token !== null &&
              decodedToken?.exp !== undefined &&
              decodedToken.iss !== undefined &&
              issuerMatches(decodedToken.iss) &&
              decodedToken.exp * 1000 > Date.now()
            ) {
              return jsonResponse({
                tokens: {
                  token: currentCookies.token,
                  refreshToken: "dummy",
                },
              });
            }
            return jsonResponse({ tokens: null });
          }
          args.refreshToken = currentCookies.refreshToken;
        }
        const client = convexClient(
          args.refreshToken !== undefined || args.params?.code !== undefined
            ? null
            : currentCookies.token,
        );

        try {
          const result = await client.action(
            signInActionRef,
            args,
          );
          if (result.redirect !== undefined) {
            const response = jsonResponse({ redirect: result.redirect });
            return attachCookies(
              response,
              serialize_auth_cookies(
                {
                  ...currentCookies,
                  verifier: result.verifier ?? null,
                },
                host,
                cookieConfig,
                cookieNamespace,
              ),
            );
          }
          if (result.tokens !== undefined) {
            const response = jsonResponse({
              tokens:
                result.tokens === null
                  ? null
                  : { token: result.tokens.token, refreshToken: "dummy" },
            });
            return attachCookies(
              response,
              serialize_auth_cookies(
                {
                  token: result.tokens?.token ?? null,
                  refreshToken: result.tokens?.refreshToken ?? null,
                  verifier: null,
                },
                host,
                cookieConfig,
                cookieNamespace,
              ),
            );
          }
          return jsonResponse(result);
        } catch (error: unknown) {
          // Forward structured error data when available (ConvexError with { code, message }).
          const errorBody =
            error instanceof ConvexError &&
            typeof error.data === "object" &&
            error.data !== null &&
            "code" in error.data
              ? { error: (error.data as { message?: string }).message ?? String(error), authError: error.data }
              : { error: error instanceof Error ? error.message : String(error) };
          const response = jsonResponse(errorBody, 400);
          const clearSession =
            args.refreshToken !== undefined &&
            shouldClearSessionForRefreshError(error);
          return attachCookies(
            response,
            serialize_auth_cookies(
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
        }
      }

      try {
        await convexClient(currentCookies.token).action(
          signOutActionRef,
        );
      } catch (error) {
        console.error(error);
        if (currentCookies.refreshToken !== null) {
          try {
            const refreshed = await convexClient().action(signInActionRef, {
              refreshToken: currentCookies.refreshToken,
            });
            if (refreshed.tokens !== undefined && refreshed.tokens !== null) {
              await convexClient(refreshed.tokens.token).action(signOutActionRef);
            }
          } catch (fallbackError) {
            console.error(fallbackError);
          }
        }
      }
      return attachCookies(
        jsonResponse(null),
        serialize_auth_cookies(
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
      const host = cookieHost(request);
      const currentCookies = parseRequestCookies(request);
      const currentToken = currentCookies.token;

      // CORS request — do not mutate auth cookies from cross-origin requests.
      if (isCorsRequest(request)) {
        return {
          cookies: [],
          token: null,
        };
      }

      // OAuth code exchange — exchange code for tokens and redirect.
      const requestUrl = new URL(request.url);
      const code = requestUrl.searchParams.get("code");
      const shouldHandleCode =
        options.should_handle_code === undefined
          ? true
          : typeof options.should_handle_code === "function"
            ? await options.should_handle_code(request)
            : options.should_handle_code;

      if (
        code !== null &&
        request.method === "GET" &&
        request.headers.get("accept")?.includes("text/html") &&
        shouldHandleCode
      ) {
        const redirectUrl = new URL(requestUrl);
        try {
          const result = await convexClient().action(
            signInActionRef,
            {
              params: { code },
              verifier: currentCookies.verifier ?? undefined,
            },
          );
          if (result.tokens === undefined) {
            throw new Error(
              "Invalid `auth/session:start` result for code exchange",
            );
          }
          redirectUrl.searchParams.delete("code");
          return {
            cookies: structured_auth_cookies(
              {
                token: result.tokens?.token ?? null,
                refreshToken: result.tokens?.refreshToken ?? null,
                verifier: null,
              },
              host,
              cookieConfig,
              cookieNamespace,
            ),
            redirect: redirectUrl.toString(),
            token: result.tokens?.token ?? null,
          };
        } catch (error) {
          console.error(error);
          if (!isTerminalCodeExchangeError(error)) {
            return {
              cookies: [],
              token: currentCookies.token,
            };
          }

          redirectUrl.searchParams.delete("code");
          return {
            cookies: structured_auth_cookies(
              {
                token: currentCookies.token,
                refreshToken: currentCookies.refreshToken,
                verifier: null,
              },
              host,
              cookieConfig,
              cookieNamespace,
            ),
            redirect: redirectUrl.toString(),
            token: currentCookies.token,
          };
        }
      }

      // Normal page load — refresh tokens if needed.
      const tokens = await refreshTokens(request);
      if (tokens === undefined) {
        // No refresh needed — return current token for hydration.
        return { cookies: [], token: currentToken };
      }
      return {
        cookies: structured_auth_cookies(
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
