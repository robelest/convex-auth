import { env } from "$env/dynamic/private";

function requireSiteUrl() {
  const siteUrl =
    env.CONVEX_SITE_URL ?? env.VITE_CONVEX_URL?.replace(".cloud", ".site");
  if (!siteUrl) {
    throw new Error("Missing CONVEX_SITE_URL or VITE_CONVEX_URL for API proxying.");
  }
  return siteUrl;
}

export async function proxyApiRequest(request: Request, path: string) {
  const upstreamUrl = new URL(path, requireSiteUrl());
  const incomingUrl = new URL(request.url);
  upstreamUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.set("host", upstreamUrl.host);

  return await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.text(),
  });
}
