import { requireEnv, envOptionalString, readConfigSync } from "./env";

/** @internal */
export function normalizeUrl(url: string) {
  return url.replace(/\/$/, "");
}

/** @internal */
export function siteUrlsFromEnv() {
  const primaryUrl = normalizeUrl(requireEnv("SITE_URL"));
  const secondary = readConfigSync(envOptionalString("SECONDARY_URL"));
  const secondaryUrls =
    secondary
      ?.split(",")
      .map((url) => url.trim())
      .filter((url) => url.length > 0)
      .map(normalizeUrl) ?? [];
  return {
    primaryUrl,
    allowedUrls: [...new Set([primaryUrl, ...secondaryUrls])],
  };
}

/** @internal */
export function isLocalHost(host?: string) {
  if (host === undefined) {
    return false;
  }
  const raw = host.includes("://") ? host : `http://${host}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}
