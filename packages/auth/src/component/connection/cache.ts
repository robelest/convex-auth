/**
 * `component.connection.cache.*` — read-through cache for external Connection
 * HTTP fetches (OIDC discovery, SAML metadata, OIDC status validation).
 *
 * Each cache wraps an `internalAction` that performs the fetch on miss.
 * The cache key is `(name, args)` where `args` is the URL (plus optional
 * proxy hints). Cache entries persist in the action-cache component's
 * tables, so concurrent / sequential requests for the same URL share
 * results.
 *
 * Direct callers go through the exposed `*Discovery`, `*Metadata`,
 * `*StatusDiscovery` actions which are thin wrappers over the cache's
 * `.fetch()` method. Server-side code at `server/connection/` invokes these via
 * `ctx.runAction(components.auth.connection.cache.X, args)`.
 *
 * To invalidate (e.g. when an admin updates `discoveryUrl` or
 * `metadataUrl`), call the matching `invalidate*` mutation.
 *
 * @module
 */

import { ActionCache } from "@convex-dev/action-cache";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v } from "convex/values";

import { components, internal } from "../_generated/api";
import { action, internalAction, mutation } from "../functions";
import { assertSafeIdpFetchUrl, assertSafeIdpHost } from "../../shared/fetch/guard";

/**
 * One isolated typed bridge across `ActionCache.fetch`'s ctx boundary. An
 * `action` handler's ctx supplies `runQuery`/`runMutation`/`runAction`, but over
 * this component's concrete DataModel, which TS treats as incompatible with the
 * action-cache's `GenericDataModel` under invariance — so the two cannot be
 * unified positively. Each caller infers the exact target from the `.fetch`
 * parameter, so results stay precisely typed.
 */
function asActionCacheCtx<T>(ctx: object): T {
  return ctx as T;
}

const fetchUrlArgs = {
  /** Absolute URL to fetch. */
  url: v.string(),
  /**
   * Optional proxy-mode origin. When set, the request is sent to
   * `runtimeOrigin + url.pathname + url.search` instead of `url.origin`.
   * Used by self-hosted Convex deployments fronting an external IdP via
   * an internal hostname.
   */
  runtimeOrigin: v.optional(v.string()),
  /** Optional `Host` header value (paired with `runtimeOrigin`). */
  externalHost: v.optional(v.string()),
};

function normalizeRuntimeOrigin(runtimeOrigin: string | undefined): string | undefined {
  if (runtimeOrigin === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(runtimeOrigin);
  } catch {
    throw new Error("runtimeOrigin must be a valid absolute URL.");
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("runtimeOrigin must be an origin with no path, query, hash, or credentials.");
  }
  assertSafeIdpFetchUrl(parsed.origin);
  return parsed.origin;
}

function validateExternalHost(externalHost: string | undefined, runtimeOrigin: string | undefined) {
  if (externalHost === undefined) {
    return;
  }
  if (runtimeOrigin === undefined) {
    throw new Error("externalHost requires runtimeOrigin.");
  }
  assertSafeIdpHost(externalHost);
}

const buildRequestUrl = (
  url: string,
  runtimeOrigin: string | undefined,
  externalHost: string | undefined,
): { url: URL; headers: Headers } => {
  assertSafeIdpFetchUrl(url);
  const normalizedRuntimeOrigin = normalizeRuntimeOrigin(runtimeOrigin);
  validateExternalHost(externalHost, normalizedRuntimeOrigin);
  const parsed = new URL(url);
  const rewritten =
    normalizedRuntimeOrigin !== undefined && parsed.origin !== normalizedRuntimeOrigin
      ? new URL(`${normalizedRuntimeOrigin}${parsed.pathname}${parsed.search}`)
      : parsed;
  assertSafeIdpFetchUrl(rewritten.toString());
  const headers = new Headers();
  if (normalizedRuntimeOrigin !== undefined && externalHost !== undefined) {
    headers.set("host", externalHost);
  }
  return { url: rewritten, headers };
};

/** Request a URL and parse the response as JSON. @internal */
export const requestJson = internalAction({
  args: fetchUrlArgs,
  returns: v.any(),
  handler: async (_ctx, { url, runtimeOrigin, externalHost }) => {
    const req = buildRequestUrl(url, runtimeOrigin, externalHost);
    const response = await fetch(req.url, {
      headers: req.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return await response.json();
  },
});

/** Request a URL and return the response body as text. @internal */
export const requestText = internalAction({
  args: fetchUrlArgs,
  returns: v.string(),
  handler: async (_ctx, { url, runtimeOrigin, externalHost }) => {
    const req = buildRequestUrl(url, runtimeOrigin, externalHost);
    const response = await fetch(req.url, {
      headers: req.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }
    return await response.text();
  },
});

const ONE_HOUR = 60 * 60 * 1000;
const TWO_HOURS = 2 * ONE_HOUR;
const ONE_DAY = 24 * ONE_HOUR;

const oidcDiscoveryCache: ActionCache<typeof internal.connection.cache.requestJson> = new ActionCache(
  components.connectionFetchCache,
  {
    action: internal.connection.cache.requestJson,
    name: "oidcDiscovery",
    ttl: ONE_HOUR,
  },
);

const oidcStatusDiscoveryCache: ActionCache<typeof internal.connection.cache.requestJson> =
  new ActionCache(components.connectionFetchCache, {
    action: internal.connection.cache.requestJson,
    name: "oidcStatusDiscovery",
    ttl: TWO_HOURS,
  });

const samlMetadataCache: ActionCache<typeof internal.connection.cache.requestText> = new ActionCache(
  components.connectionFetchCache,
  {
    action: internal.connection.cache.requestText,
    name: "samlMetadata",
    ttl: ONE_DAY,
  },
);

/**
 * Read-through fetch for OIDC discovery JSON. Cached 1h per URL.
 */
export const oidcDiscovery = action({
  args: fetchUrlArgs,
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    return await oidcDiscoveryCache.fetch(asActionCacheCtx(ctx), args);
  },
});

/**
 * Read-through fetch for OIDC discovery during admin status validation.
 * Cached 2h per URL (separate from the runtime sign-in path so admin
 * dashboards don't share keys with hot-path traffic).
 */
export const oidcStatusDiscovery = action({
  args: fetchUrlArgs,
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    return await oidcStatusDiscoveryCache.fetch(asActionCacheCtx(ctx), args);
  },
});

/**
 * Read-through fetch for SAML IdP metadata XML. Cached 24h per URL.
 */
export const samlMetadata = action({
  args: fetchUrlArgs,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    return await samlMetadataCache.fetch(asActionCacheCtx(ctx), args);
  },
});

/** Invalidate a cached OIDC discovery entry (e.g. on `discoveryUrl` update). */
export const invalidateOidcDiscovery = mutation({
  args: fetchUrlArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await oidcDiscoveryCache.remove(ctx, args);
    await oidcStatusDiscoveryCache.remove(ctx, args);
    return null;
  },
});

/** Invalidate a cached SAML metadata entry (e.g. on `metadataUrl` update). */
export const invalidateSamlMetadata = mutation({
  args: fetchUrlArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await samlMetadataCache.remove(ctx, args);
    return null;
  },
});
