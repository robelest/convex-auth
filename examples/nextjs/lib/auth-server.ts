import { parseAuthCookies, serializeAuthCookies } from "@convex-dev/auth/server";
import {
  IsAuthenticatedQuery,
  SignInAction,
  SignOutAction,
} from "@convex-dev/auth/component";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function hostFromRequestHeaders(host: string | null | undefined) {
  return host ?? undefined;
}

export async function convexAuthToken() {
  const headerList = await headers();
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return parseAuthCookies(cookieHeader, hostFromRequestHeaders(headerList.get("host"))).token;
}

export async function isAuthenticated() {
  const token = await convexAuthToken();
  if (!token) {
    return false;
  }
  try {
    return await fetchQuery("auth:isAuthenticated" as unknown as IsAuthenticatedQuery, {}, { token });
  } catch {
    return false;
  }
}

export async function proxyAuthRoute(request: NextRequest) {
  if (request.method !== "POST") {
    return new NextResponse("Invalid method", { status: 405 });
  }
  const body = (await request.json()) as {
    action: "auth:signIn" | "auth:signOut";
    args: any;
  };
  if (body.action !== "auth:signIn" && body.action !== "auth:signOut") {
    return new NextResponse("Invalid action", { status: 400 });
  }

  const host = hostFromRequestHeaders(request.headers.get("host"));
  const parsedCookies = parseAuthCookies(request.headers.get("cookie"), host);

  if (body.action === "auth:signIn") {
    const args = body.args ?? {};
    const isRefreshFlow = args.refreshToken !== undefined;
    if (isRefreshFlow) {
      if (parsedCookies.refreshToken === null) {
        const response = NextResponse.json({ tokens: null }, { status: 200 });
        for (const value of serializeAuthCookies(
          { token: null, refreshToken: null, verifier: null },
          host,
        )) {
          response.headers.append("Set-Cookie", value);
        }
        return response;
      }
      args.refreshToken = parsedCookies.refreshToken;
    }
    const tokenForCall =
      isRefreshFlow || args.params?.code !== undefined
        ? undefined
        : parsedCookies.token ?? undefined;

    try {
      const result = await fetchAction(
        "auth:signIn" as unknown as SignInAction,
        args,
        tokenForCall ? { token: tokenForCall } : {},
      );

      if (result.redirect !== undefined) {
        const response = NextResponse.json({ redirect: result.redirect }, { status: 200 });
        const cookieHeaders = serializeAuthCookies(
          {
            token: parsedCookies.token,
            refreshToken: parsedCookies.refreshToken,
            verifier: result.verifier ?? null,
          },
          host,
        );
        for (const value of cookieHeaders) {
          response.headers.append("Set-Cookie", value);
        }
        return response;
      }

      const response = NextResponse.json(
        {
          ...result,
          tokens:
            result.tokens === undefined
              ? undefined
              : result.tokens === null
                ? null
                : { token: result.tokens.token, refreshToken: "dummy" },
        },
        { status: 200 },
      );
      const cookieHeaders = serializeAuthCookies(
        {
          token: result.tokens?.token ?? null,
          refreshToken: result.tokens?.refreshToken ?? null,
          verifier: null,
        },
        host,
      );
      for (const value of cookieHeaders) {
        response.headers.append("Set-Cookie", value);
      }
      return response;
    } catch (error) {
      const response = NextResponse.json(
        { error: (error as Error).message },
        { status: 400 },
      );
      for (const value of serializeAuthCookies(
        { token: null, refreshToken: null, verifier: null },
        host,
      )) {
        response.headers.append("Set-Cookie", value);
      }
      return response;
    }
  }

  try {
    await fetchAction(
      "auth:signOut" as unknown as SignOutAction,
      body.args ?? {},
      parsedCookies.token ? { token: parsedCookies.token } : {},
    );
  } catch {
    // Ignore sign out errors.
  }
  const response = NextResponse.json(null, { status: 200 });
  for (const value of serializeAuthCookies(
    { token: null, refreshToken: null, verifier: null },
    host,
  )) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}
