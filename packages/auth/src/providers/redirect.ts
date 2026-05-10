import { envOptionalString, readConfigSync } from "../server/env";

function normalizeRoutePrefix(prefix: string | undefined) {
  if (prefix === undefined || prefix === "" || prefix === "/") {
    return "";
  }
  const withSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return withSlash.replace(/\/$/, "");
}

/** @internal */
export function defaultOAuthRedirectUri(providerId: string) {
  const customAuthSiteUrl = readConfigSync(envOptionalString("CUSTOM_AUTH_SITE_URL"));
  if (customAuthSiteUrl) {
    return `${customAuthSiteUrl.replace(/\/$/, "")}/callback/${providerId}`;
  }

  const convexSiteUrl = readConfigSync(envOptionalString("CONVEX_SITE_URL"));
  if (!convexSiteUrl) {
    throw new Error(
      `Missing CONVEX_SITE_URL while configuring ${providerId} OAuth provider. ` +
        "Set CONVEX_SITE_URL or pass redirectUri explicitly.",
    );
  }

  const prefix = normalizeRoutePrefix(
    readConfigSync(envOptionalString("CONVEX_AUTH_HTTP_PREFIX")) ?? "/auth",
  );
  return `${convexSiteUrl.replace(/\/$/, "")}${prefix}/callback/${providerId}`;
}
