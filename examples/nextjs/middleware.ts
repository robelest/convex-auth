import { parseAuthCookies } from "@convex-dev/auth/server";
import { IsAuthenticatedQuery } from "@convex-dev/auth/component";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";

function isSignInPage(request: NextRequest) {
  return request.nextUrl.pathname === "/signin";
}

function isProtectedRoute(request: NextRequest) {
  return /^\/product(\/.*)?$/.test(request.nextUrl.pathname);
}

async function isAuthenticatedRequest(request: NextRequest) {
  const { token } = parseAuthCookies(
    request.headers.get("cookie"),
    request.headers.get("host") ?? undefined,
  );
  if (!token) {
    return false;
  }
  try {
    return await fetchQuery("auth:isAuthenticated" as unknown as IsAuthenticatedQuery, {}, { token });
  } catch {
    return false;
  }
}

export default async function middleware(request: NextRequest) {
  const authed = await isAuthenticatedRequest(request);

  if (isSignInPage(request) && authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/product";
    return NextResponse.redirect(url);
  }

  if (isProtectedRoute(request) && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
