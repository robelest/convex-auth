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
  /** Convex deployment URL (e.g. `https://your-app.convex.cloud`). */
  url: string;
  /**
   * Path the client POSTs auth actions to. Defaults to `"/api/auth"`.
   * Must match the `proxy` option on the client.
   */
  apiRoute?: string;
  /** Cookie `maxAge` in seconds, or `null` for session cookies. */
  cookieMaxAge?: number | null;
  /** Enable verbose debug logging for token refresh and cookie operations. */
  verbose?: boolean;
  /**
   * Control whether `refresh()` handles OAuth `?code=` query parameters.
   *
   * - `true` (default): always exchange the code on GET requests with `text/html` accept.
   * - `false`: never exchange — useful when only the client handles codes.
   * - A function: called with the `Request` for per-request decisions.
   */
  shouldHandleCode?: ((request: Request) => boolean | Promise<boolean>) | boolean;
};

export type RefreshResult = {
  /** Structured cookies to set on the response. */
  cookies: AuthCookie[];
  /** URL to redirect to (set after OAuth code exchange). */
  redirect?: string;
  /** JWT for SSR hydration, or `null` if not authenticated. */
  token: string | null;
};

/**
 * Derive the cookie names used for auth tokens.
 *
 * On localhost the names are unprefixed; on production hosts they
 * use the `__Host-` prefix for tighter security.
 *
 * @param host - The `Host` header value. Omit to use unprefixed names.
 * @returns An object with `token`, `refreshToken`, and `verifier` cookie names.
 */
export function authCookieNames(host?: string) {
  const prefix = isLocalHost(host) ? "" : "__Host-";
  return {
    token: `${prefix}__convexAuthJWT`,
    refreshToken: `${prefix}__convexAuthRefreshToken`,
    verifier: `${prefix}__convexAuthOAuthVerifier`,
  };
}

/**
 * Parse auth cookie values from a raw `Cookie` header string.
 *
 * @param cookieHeader - The raw `Cookie` header, or `null`/`undefined`.
 * @param host - The `Host` header, used to determine cookie name prefixes.
 * @returns Parsed {@link AuthCookies} with `token`, `refreshToken`, and `verifier`.
 */
export function parseAuthCookies(
  cookieHeader: string | null | undefined,
  host?: string,
): AuthCookies {
  const names = authCookieNames(host);
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
 * @returns An array of three `Set-Cookie` header strings.
 */
export function serializeAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
) {
  const names = authCookieNames(host);
  const secure = !isLocalHost(host);
  const base = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
  };
  const maxAge = config.maxAge ?? undefined;
  return [
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
}

/**
 * Build structured cookie objects for any SSR framework.
 *
 * Use with SvelteKit's `event.cookies.set()`, TanStack Start's `setCookie()`,
 * Next.js's `cookies().set()`, or any other framework cookie API.
 */
export function structuredAuthCookies(
  cookies: AuthCookies,
  host?: string,
  config: AuthCookieConfig = { maxAge: null },
): AuthCookie[] {
  const names = authCookieNames(host);
  const secure = !isLocalHost(host);
  const base = {
    path: "/" as const,
    httpOnly: true as const,
    secure,
    sameSite: "lax" as const,
  };
  const maxAge = config.maxAge ?? undefined;
  return [
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
 */
export function shouldProxyAuthAction(pathname: string, apiRoute: string) {
  if (apiRoute.endsWith("/")) {
    return pathname === apiRoute || pathname === apiRoute.slice(0, -1);
  }
  return pathname === apiRoute || pathname === `${apiRoute}/`;
}

const REQUIRED_TOKEN_LIFETIME_MS = 60_000;
const MINIMUM_REQUIRED_TOKEN_LIFETIME_MS = 10_000;

type DecodedToken = { exp?: number; iat?: number };

/**
 * Create an SSR auth helper for server-side frameworks.
 *
 * Handles cookie-based token management, OAuth code exchange,
 * and automatic JWT refresh on page loads. Works with any
 * framework that gives you a `Request` object — SvelteKit,
 * TanStack Start, Remix, Next.js, etc.
 *
 * @param options - SSR configuration (Convex URL, proxy route, cookie lifetime).
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
 */
export function server(options: ServerOptions) {
  const convexUrl = options.url;
  const apiRoute = options.apiRoute ?? "/api/auth";
  const cookieConfig = { maxAge: options.cookieMaxAge ?? null };
  const verbose = options.verbose ?? false;

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

  const parseRequestCookies = (request: Request) => {
    return parseAuthCookies(request.headers.get("cookie"), cookieHost(request));
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
    const requestUrl = new URL(request.url);
    const originUrl = new URL(originHeader);
    return (
      originUrl.host !== requestUrl.host ||
      originUrl.protocol !== requestUrl.protocol
    );
  };

  const decodeToken = (token: string): DecodedToken | null => {
    try {
      return jwtDecode<DecodedToken>(token);
    } catch {
      return null;
    }
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
    if (refreshToken === null && token === null) {
      logVerbose("No auth cookies found, skipping refresh");
      return undefined;
    }
    if (refreshToken === null || token === null) {
      logVerbose("Only one auth cookie present, clearing auth cookies");
      return null;
    }
    const decodedToken = decodeToken(token);
    if (decodedToken?.exp === undefined || decodedToken.iat === undefined) {
      logVerbose("Failed to decode token, clearing auth cookies");
      return null;
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

    try {
      const result = await convexClient().action(
        signInActionRef,
        {
          refreshToken,
        },
      );
      if (result.tokens === undefined) {
        throw new Error("Invalid `auth:signIn` result for token refresh");
      }
      logVerbose(`Refreshed tokens, null=${result.tokens === null}`);
      return result.tokens;
    } catch (error) {
      console.error(error);
      logVerbose("Token refresh failed, clearing auth cookies");
      return null;
    }
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
      if (decodedToken?.exp === undefined) {
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
      if (!shouldProxyAuthAction(requestUrl.pathname, apiRoute)) {
        return new Response("Invalid route", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Invalid method", { status: 405 });
      }
      if (isCorsRequest(request)) {
        return new Response("Invalid origin", { status: 403 });
      }

      const body = await request.json();
      const action = body.action as string;
      const args = (body.args ?? {}) as Record<string, any>;

      if (action !== "auth:signIn" && action !== "auth:signOut") {
        return new Response("Invalid action", { status: 400 });
      }

      const currentCookies = parseRequestCookies(request);
      const host = cookieHost(request);

      if (action === "auth:signIn") {
        if (args.refreshToken !== undefined) {
          if (currentCookies.refreshToken === null) {
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
              serializeAuthCookies(
                {
                  ...currentCookies,
                  verifier: result.verifier ?? null,
                },
                host,
                cookieConfig,
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
              serializeAuthCookies(
                {
                  token: result.tokens?.token ?? null,
                  refreshToken: result.tokens?.refreshToken ?? null,
                  verifier: null,
                },
                host,
                cookieConfig,
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
          return attachCookies(
            response,
            serializeAuthCookies(
              {
                token: null,
                refreshToken: null,
                verifier: null,
              },
              host,
              cookieConfig,
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
      }
      return attachCookies(
        jsonResponse(null),
        serializeAuthCookies(
          {
            token: null,
            refreshToken: null,
            verifier: null,
          },
          host,
          cookieConfig,
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
      const currentToken = parseRequestCookies(request).token;

      // CORS request — clear all auth cookies.
      if (isCorsRequest(request)) {
        return {
          cookies: structuredAuthCookies(
            { token: null, refreshToken: null, verifier: null },
            host,
            cookieConfig,
          ),
          token: null,
        };
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

      if (
        code !== null &&
        request.method === "GET" &&
        request.headers.get("accept")?.includes("text/html") &&
        shouldHandleCode
      ) {
        const requestCookies = parseRequestCookies(request);
        const redirectUrl = new URL(requestUrl);
        redirectUrl.searchParams.delete("code");
        try {
          const result = await convexClient().action(
            signInActionRef,
            {
              params: { code },
              verifier: requestCookies.verifier ?? undefined,
            },
          );
          if (result.tokens === undefined) {
            throw new Error("Invalid `auth:signIn` result for code exchange");
          }
          return {
            cookies: structuredAuthCookies(
              {
                token: result.tokens?.token ?? null,
                refreshToken: result.tokens?.refreshToken ?? null,
                verifier: null,
              },
              host,
              cookieConfig,
            ),
            redirect: redirectUrl.toString(),
            token: result.tokens?.token ?? null,
          };
        } catch (error) {
          console.error(error);
          return {
            cookies: structuredAuthCookies(
              { token: null, refreshToken: null, verifier: null },
              host,
              cookieConfig,
            ),
            redirect: redirectUrl.toString(),
            token: null,
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
        cookies: structuredAuthCookies(
          {
            token: tokens?.token ?? null,
            refreshToken: tokens?.refreshToken ?? null,
            verifier: null,
          },
          host,
          cookieConfig,
        ),
        token: tokens?.token ?? null,
      };
    },
  };
}
