import { env } from "$env/dynamic/private";
import { server, type RefreshResult } from "@robelest/convex-auth/server";

export function getAuthServer() {
  const convexUrl = env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing VITE_CONVEX_URL for the Svelte demo app.");
  }
  return server({ url: convexUrl });
}

export function applyAuthCookies(
  cookies: import("@sveltejs/kit").Cookies,
  result: RefreshResult,
) {
  if (result.redirect) return;
  for (const cookie of result.cookies) {
    cookies.set(cookie.name, cookie.value, {
      ...cookie.options,
    });
  }
}
