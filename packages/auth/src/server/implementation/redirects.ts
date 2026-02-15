import { ConvexAuthMaterializedConfig } from "../types";
import { requireEnv } from "../utils";
import { throwAuthError } from "../errors";

export async function redirectAbsoluteUrl(
  config: ConvexAuthMaterializedConfig,
  params: { redirectTo: unknown },
) {
  if (params.redirectTo !== undefined) {
    if (typeof params.redirectTo !== "string") {
      throwAuthError("INVALID_REDIRECT", `Expected \`redirectTo\` to be a string, got ${params.redirectTo as any}`);
    }
    const redirectCallback =
      config.callbacks?.redirect ?? defaultRedirectCallback;
    return await redirectCallback(params as { redirectTo: string });
  }
  return siteUrl();
}

async function defaultRedirectCallback({ redirectTo }: { redirectTo: string }) {
  // Resolve relative paths against SITE_URL; absolute URLs are passed through
  // as-is. The developer is trusted to provide valid redirect targets.
  if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
    return `${siteUrl()}${redirectTo}`;
  }
  return redirectTo;
}

// Temporary work-around because Convex doesn't support
// schemes other than http and https.
export function setURLSearchParam(
  absoluteUrl: string,
  param: string,
  value: string,
) {
  const pattern = /([^:]+):(.*)/;
  const [, scheme, rest] = absoluteUrl.match(pattern)!;
  const hasNoDomain = /^\/\/(?:\/|$|\?)/.test(rest);
  const startsWithPath = hasNoDomain && rest.startsWith("///");
  const url = new URL(
    `http:${hasNoDomain ? "//googblibok" + rest.slice(2) : rest}`,
  );
  url.searchParams.set(param, value);
  const [, , withParam] = url.toString().match(pattern)!;
  return `${scheme}:${hasNoDomain ? (startsWithPath ? "/" : "") + "//" + withParam.slice(13) : withParam}`;
}

function siteUrl() {
  return requireEnv("SITE_URL").replace(/\/$/, "");
}
