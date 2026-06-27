import { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { requireEnv } from "./env";
import { ConvexAuthMaterializedConfig } from "./types";
import { normalizeUrl, siteUrlsFromEnv } from "./url";

const describeUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  const json = JSON.stringify(value);
  return json ?? Object.prototype.toString.call(value);
};

/**
 * Resolve a sign-in `redirectTo` param to an absolute URL.
 *
 * Relative paths (`/`, `?`) resolve against `SITE_URL`. Absolute URLs are
 * accepted only when they target an allowed destination: an `http(s)` origin in
 * `SITE_URL`/`SECONDARY_URL`, or a native deep-link base listed in
 * `SECONDARY_URL` (e.g. `myapp://auth`). Any other absolute URL is rejected and
 * falls back to `SITE_URL`, so a crafted `redirectTo` cannot turn the auth
 * origin into an open redirect that leaks the sign-in code. Falls back to
 * `SITE_URL` when `redirectTo` is omitted.
 *
 * @throws ConvexError `INVALID_REDIRECT` when `redirectTo` is not a string.
 * @internal
 */
export async function redirectAbsoluteUrl(
  _ctx: GenericActionCtx<GenericDataModel>,
  config: ConvexAuthMaterializedConfig,
  params: { redirectTo: unknown },
) {
  if (params.redirectTo === undefined) {
    return normalizeUrl(requireEnv("SITE_URL"));
  }
  if (typeof params.redirectTo !== "string") {
    throw new ConvexError({
      code: ErrorCode.INVALID_REDIRECT,
      message: `Expected \`redirectTo\` to be a string, got ${describeUnknown(params.redirectTo)}`,
    });
  }
  const redirectTo = params.redirectTo;
  try {
    return defaultRedirectCallback({ redirectTo });
  } catch {
    throw new ConvexError({
      code: ErrorCode.INTERNAL_ERROR,
      message: "An unexpected error occurred.",
    });
  }
}

function defaultRedirectCallback({ redirectTo }: { redirectTo: string }) {
  const siteUrl = normalizeUrl(requireEnv("SITE_URL"));
  if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
    return `${siteUrl}${redirectTo}`;
  }
  return isAllowedAbsoluteRedirect(redirectTo) ? redirectTo : siteUrl;
}

function isAllowedAbsoluteRedirect(redirectTo: string) {
  const { allowedUrls } = siteUrlsFromEnv();
  const allowedOrigins = new Set<string>();
  for (const base of allowedUrls) {
    try {
      const parsed = new URL(base);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        allowedOrigins.add(parsed.origin);
      }
    } catch {
      continue;
    }
  }
  let target: URL | null = null;
  try {
    target = new URL(redirectTo);
  } catch {
    target = null;
  }
  if (target !== null && (target.protocol === "http:" || target.protocol === "https:")) {
    return allowedOrigins.has(target.origin);
  }
  return allowedUrls.some(
    (base) =>
      redirectTo === base ||
      redirectTo.startsWith(`${base}/`) ||
      redirectTo.startsWith(`${base}?`) ||
      redirectTo.startsWith(`${base}#`),
  );
}

/**
 * Set a query parameter on an absolute URL of any scheme.
 *
 * Works around the Convex runtime's `URL` only supporting `http`/`https`: the
 * scheme is split off, the parameter set on an `http`-normalized URL, then the
 * original scheme is restored.
 *
 * @internal
 */
export function setURLSearchParam(absoluteUrl: string, param: string, value: string) {
  const pattern = /([^:]+):(.*)/;
  const schemeMatch = absoluteUrl.match(pattern);
  if (!schemeMatch) {
    throw new ConvexError({
      code: ErrorCode.INVALID_REDIRECT,
      message: "Redirect URL is missing a scheme.",
    });
  }
  const [, scheme, rest] = schemeMatch;
  const hasNoDomain = /^\/\/(?:\/|$|\?)/.test(rest);
  const startsWithPath = hasNoDomain && rest.startsWith("///");
  const url = new URL(`http:${hasNoDomain ? "//googblibok" + rest.slice(2) : rest}`);
  url.searchParams.set(param, value);
  const withParamMatch = url.toString().match(pattern);
  if (!withParamMatch) {
    throw new ConvexError({
      code: ErrorCode.INVALID_REDIRECT,
      message: "Internal URL serialization produced a malformed result.",
    });
  }
  const [, , withParam] = withParamMatch;
  return `${scheme}:${hasNoDomain ? (startsWithPath ? "/" : "") + "//" + withParam.slice(13) : withParam}`;
}
