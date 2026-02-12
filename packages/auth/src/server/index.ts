import { ConvexHttpClient } from "convex/browser";
import { jwtDecode } from "jwt-decode";
import { parse, serialize } from "cookie";
import type {
  SignInAction,
  SignOutAction,
} from "./implementation/index.js";
import { isLocalHost } from "./utils.js";

export type AuthCookieConfig = {
  maxAge: number | null;
};

export type AuthCookies = {
  token: string | null;
  refreshToken: string | null;
  verifier: string | null;
};

export type ServerOptions = {
  /** Convex deployment URL. */
  url: string;
  apiRoute?: string;
  cookieMaxAge?: number | null;
  verbose?: boolean;
  shouldHandleCode?: ((request: Request) => boolean | Promise<boolean>) | boolean;
};

export type RefreshResult = {
  response?: Response;
  cookies?: string[];
};

export function authCookieNames(host?: string) {
  const prefix = isLocalHost(host) ? "" : "__Host-";
  return {
    token: `${prefix}__convexAuthJWT`,
    refreshToken: `${prefix}__convexAuthRefreshToken`,
    verifier: `${prefix}__convexAuthOAuthVerifier`,
  };
}

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

export function shouldProxyAuthAction(pathname: string, apiRoute: string) {
  if (apiRoute.endsWith("/")) {
    return pathname === apiRoute || pathname === apiRoute.slice(0, -1);
  }
  return pathname === apiRoute || pathname === `${apiRoute}/`;
}

const REQUIRED_TOKEN_LIFETIME_MS = 60_000;
const MINIMUM_REQUIRED_TOKEN_LIFETIME_MS = 10_000;

type DecodedToken = { exp?: number; iat?: number };

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
        "auth:signIn" as unknown as SignInAction,
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
    token(request: Request): string | null {
      return parseRequestCookies(request).token;
    },

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
            "auth:signIn" as unknown as SignInAction,
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
        } catch (error) {
          const response = jsonResponse({ error: (error as Error).message }, 400);
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
          "auth:signOut" as unknown as SignOutAction,
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

    async refresh(request: Request): Promise<RefreshResult> {
      const host = cookieHost(request);

      if (isCorsRequest(request)) {
        return {
          cookies: serializeAuthCookies(
            {
              token: null,
              refreshToken: null,
              verifier: null,
            },
            host,
            cookieConfig,
          ),
        };
      }

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
            "auth:signIn" as unknown as SignInAction,
            {
              params: { code },
              verifier: requestCookies.verifier ?? undefined,
            },
          );
          if (result.tokens === undefined) {
            throw new Error("Invalid `auth:signIn` result for code exchange");
          }
          const response = Response.redirect(redirectUrl.toString(), 302);
          return {
            response: attachCookies(
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
            ),
          };
        } catch (error) {
          console.error(error);
          const response = Response.redirect(redirectUrl.toString(), 302);
          return {
            response: attachCookies(
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
            ),
          };
        }
      }

      const tokens = await refreshTokens(request);
      if (tokens === undefined) {
        return {};
      }
      return {
        cookies: serializeAuthCookies(
          {
            token: tokens?.token ?? null,
            refreshToken: tokens?.refreshToken ?? null,
            verifier: null,
          },
          host,
          cookieConfig,
        ),
      };
    },
  };
}
