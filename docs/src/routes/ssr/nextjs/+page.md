---
title: Next.js
description:
  Integrate convex-auth SSR with Next.js using middleware or server components.
---

<svelte:head>

  <title>Next.js - convex-auth</title>
</svelte:head>

# Next.js

Next.js integration uses middleware to refresh tokens on every request and the
`cookies()` API from `next/headers` to apply auth cookies.

## Middleware

The recommended approach is to call `auth.refresh()` in `middleware.ts`. This
runs on every request before your pages render.

```ts
// middleware.ts
import { server } from "@robelest/convex-auth/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const auth = server({ url: process.env.CONVEX_URL! });

export async function middleware(request: NextRequest) {
  const { cookies, redirect, token } = await auth.refresh(request);

  // Handle OAuth redirects
  if (redirect) {
    const response = NextResponse.redirect(redirect);
    for (const cookie of cookies) {
      response.cookies.set(cookie.name, cookie.value, {
        path: cookie.path ?? "/",
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite as "lax" | "strict" | "none",
        maxAge: cookie.maxAge,
      });
    }
    return response;
  }

  const response = NextResponse.next();

  // Apply auth cookies
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, {
      path: cookie.path ?? "/",
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite as "lax" | "strict" | "none",
      maxAge: cookie.maxAge,
    });
  }

  // Pass token via header for server components
  if (token) {
    response.headers.set("x-convex-token", token);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

## Auth proxy route

Create `app/api/auth/route.ts` to handle client-side sign-in and sign-out:

```ts
// app/api/auth/route.ts
import { server } from "@robelest/convex-auth/server";

const auth = server({ url: process.env.CONVEX_URL! });

export async function POST(request: Request) {
  return auth.proxy(request);
}
```

## Server component usage

In a server component or layout, read the token from cookies using
`next/headers`:

```ts
// app/layout.tsx
import { cookies } from "next/headers";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const token = cookieStore.get("convex-auth-token")?.value ?? null;

  return (
    <html>
      <body>
        <ConvexAuthProvider token={token}>{children}</ConvexAuthProvider>
      </body>
    </html>
  );
}
```
