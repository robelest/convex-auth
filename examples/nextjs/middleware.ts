import { parseAuthCookies } from "@convex-dev/auth/server";
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
  return token !== null;
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
