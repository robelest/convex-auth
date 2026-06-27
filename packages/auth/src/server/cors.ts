/**
 * CORS for the public authorization-server, discovery, and MCP endpoints.
 *
 * These are reached cross-origin by browser-based OAuth/MCP clients (e.g. a web
 * agent discovering the server and exchanging tokens), so they always carry
 * permissive CORS headers and answer `OPTIONS` preflights. They're bearer-token
 * endpoints (no cookies), so `*` is safe.
 *
 * @module
 */

import { httpActionGeneric, type HttpRouter } from "convex/server";

const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version";

/** CORS response headers for the public OAuth/MCP surface. */
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

/** Copy `response`, adding CORS headers. */
export function withCorsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Wrap a raw `(ctx, request) => Response` handler so its responses carry CORS
 * headers. Generic over the ctx type so it composes with both `httpActionGeneric`
 * and a deployment's specific `httpAction`.
 */
export function withCors<Ctx>(
  handler: (ctx: Ctx, request: Request) => Promise<Response>,
): (ctx: Ctx, request: Request) => Promise<Response> {
  return async (ctx, request) => withCorsResponse(await handler(ctx, request));
}

/** Shared `OPTIONS` preflight handler: `204` + CORS headers. */
export const corsPreflightHandler = httpActionGeneric(
  async () => new Response(null, { status: 204, headers: corsHeaders() }),
);

/** Register an `OPTIONS` preflight route for each distinct path (deduped). */
export function registerCorsPreflight(http: HttpRouter, paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    http.route({ path, method: "OPTIONS", handler: corsPreflightHandler });
  }
}
