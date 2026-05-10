import { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError } from "convex/values";

import { requireEnv } from "./env";
import { ConvexAuthMaterializedConfig } from "./types";

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

/** @internal */
export async function redirectAbsoluteUrl(
  ctx: GenericActionCtx<GenericDataModel>,
  config: ConvexAuthMaterializedConfig,
  params: { redirectTo: unknown },
) {
  if (params.redirectTo === undefined) {
    return requireEnv("SITE_URL").replace(/\/$/, "");
  }
  if (typeof params.redirectTo !== "string") {
    throw new ConvexError({
      code: "INVALID_REDIRECT",
      message: `Expected \`redirectTo\` to be a string, got ${describeUnknown(params.redirectTo)}`,
    });
  }
  const redirectTo = params.redirectTo;
  try {
    const before = config.callbacks?.before;
    if (before !== undefined) {
      const result = await before(
        ctx as Parameters<NonNullable<typeof before>>[0],
        { kind: "redirect", redirectTo },
      );
      if (typeof result === "string") {
        return result;
      }
    }
    return await defaultRedirectCallback({ redirectTo });
  } catch {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    });
  }
}

async function defaultRedirectCallback({ redirectTo }: { redirectTo: string }) {
  // Resolve relative paths against SITE_URL; absolute URLs are passed through
  // as-is. The developer is trusted to provide valid redirect targets.
  if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) {
    return `${requireEnv("SITE_URL").replace(/\/$/, "")}${redirectTo}`;
  }
  return redirectTo;
}

// Temporary work-around because Convex doesn't support
// schemes other than http and https.
/** @internal */
export function setURLSearchParam(absoluteUrl: string, param: string, value: string) {
  const pattern = /([^:]+):(.*)/;
  const [, scheme, rest] = absoluteUrl.match(pattern)!;
  const hasNoDomain = /^\/\/(?:\/|$|\?)/.test(rest);
  const startsWithPath = hasNoDomain && rest.startsWith("///");
  const url = new URL(`http:${hasNoDomain ? "//googblibok" + rest.slice(2) : rest}`);
  url.searchParams.set(param, value);
  const [, , withParam] = url.toString().match(pattern)!;
  return `${scheme}:${hasNoDomain ? (startsWithPath ? "/" : "") + "//" + withParam.slice(13) : withParam}`;
}
