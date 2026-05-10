/**
 * Content generators for cross-platform `.well-known` endpoints.
 *
 * These helpers produce the exact response shape expected by Apple, Google,
 * browsers, and password managers. Each helper reads convention env vars but
 * accepts explicit overrides; if neither is set, it returns `null` so the
 * caller can serve a 404.
 *
 * The library serves `/.well-known/openid-configuration` and `/.well-known/jwks.json`
 * from the Convex backend (`CONVEX_SITE_URL`). The endpoints in this module
 * must be served from the WebAuthn RP ID host (typically `SITE_URL` — the
 * frontend domain), so they're shipped as framework-agnostic generators that
 * apps wire into their own route handlers (SvelteKit `+server.ts`, Next.js
 * route handlers, Cloudflare Workers, Express, etc.). One exception:
 * `generateWebAuthnConfig` can also be served from Convex via
 * {@link addWebAuthnRoute} when RP ID equals `CONVEX_SITE_URL` host.
 *
 * @module
 */

import { envOptionalNumber, envOptionalString } from "./env";
import { normalizeUrl } from "./url";

/** Uniform shape returned by every generator. Adapt to any framework. */
export type WellKnownResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

const STATIC_CACHE = "public, max-age=300, stale-while-revalidate=3600, stale-if-error=86400";

function parseList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function ok(body: string, contentType: string): WellKnownResponse {
  return {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": STATIC_CACHE,
    },
    body,
  };
}

/**
 * Generate `/.well-known/apple-app-site-association` (AASA) content.
 *
 * Required for native iOS passkeys (`webcredentials`), Universal Links
 * (`applinks`), and Sign in with Apple. Apple's CDN fetches this file from
 * the WebAuthn RP ID host on app install/update; the file MUST be served as
 * `application/json` at the exact path with no `.json` extension and no
 * redirects.
 *
 * Reads {@link IOS_APP_IDS} (comma-separated `TEAMID.bundle.id` entries) and
 * {@link IOS_APPLINK_PATHS} (comma-separated path patterns, default `/auth/*,/callback/*`).
 *
 * @example Hosting in SvelteKit
 * ```ts
 * // src/routes/.well-known/apple-app-site-association/+server.ts
 * import { generateAppleAppSiteAssociation } from "@robelest/convex-auth/server";
 * export const GET = () => {
 *   const r = generateAppleAppSiteAssociation();
 *   if (!r) return new Response(null, { status: 404 });
 *   return new Response(r.body, { status: r.status, headers: r.headers });
 * };
 * ```
 */
export function generateAppleAppSiteAssociation(opts?: {
  /** Override `IOS_APP_IDS`; e.g., `["ABC123DEF.com.example.app"]`. */
  appIds?: string[];
  /** Override `IOS_APPLINK_PATHS`; default `["/auth/*", "/callback/*"]`. */
  applinkPaths?: string[];
}): WellKnownResponse | null {
  const appIds = opts?.appIds ?? parseList(envOptionalString("IOS_APP_IDS"));
  if (appIds.length === 0) return null;

  const applinkPaths =
    opts?.applinkPaths ?? parseList(envOptionalString("IOS_APPLINK_PATHS"));
  const components =
    applinkPaths.length > 0
      ? applinkPaths.map((path) => ({ "/": path }))
      : [{ "/": "/auth/*" }, { "/": "/callback/*" }];

  const body = JSON.stringify({
    applinks: {
      details: [{ appIDs: appIds, components }],
    },
    webcredentials: { apps: appIds },
  });
  return ok(body, "application/json");
}

/**
 * Generate `/.well-known/assetlinks.json` content for Android.
 *
 * Required for Android Credential Manager to surface passkeys for the app,
 * and for App Link verification (`autoVerify="true"` intent filters). Google
 * fetches this file from the WebAuthn RP ID host.
 *
 * Reads {@link ANDROID_APP_LINKS} in the format
 * `package1:FP1:FP2;package2:FP1:FP2` where each fingerprint is a colon-
 * separated SHA-256 hex string. Use `;` between apps and `:` to separate
 * package name from fingerprints (and fingerprints share the standard
 * `AA:BB:CC:...` colon format — split on `:`, the first segment is the
 * package, the rest is the fingerprint reassembled).
 *
 * For programmatic config, prefer the `apps` option which avoids parsing.
 *
 * @example Direct config
 * ```ts
 * generateAssetLinks({
 *   apps: [{
 *     packageName: "com.example.app",
 *     sha256Fingerprints: ["AA:BB:CC:..."],
 *   }],
 * });
 * ```
 */
export function generateAssetLinks(opts?: {
  apps?: Array<{ packageName: string; sha256Fingerprints: string[] }>;
}): WellKnownResponse | null {
  const apps = opts?.apps ?? parseAndroidAppLinksEnv(envOptionalString("ANDROID_APP_LINKS"));
  if (apps.length === 0) return null;

  const body = JSON.stringify(
    apps.map((app) => ({
      relation: [
        "delegate_permission/common.get_login_creds",
        "delegate_permission/common.handle_all_urls",
      ],
      target: {
        namespace: "android_app",
        package_name: app.packageName,
        sha256_cert_fingerprints: app.sha256Fingerprints,
      },
    })),
  );
  return ok(body, "application/json");
}

function parseAndroidAppLinksEnv(
  raw: string | undefined,
): Array<{ packageName: string; sha256Fingerprints: string[] }> {
  if (raw === undefined) return [];
  const apps: Array<{ packageName: string; sha256Fingerprints: string[] }> = [];
  for (const entry of raw.split(";")) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) continue;
    const packageName = trimmed.slice(0, firstColon).trim();
    const fingerprintsRaw = trimmed.slice(firstColon + 1).trim();
    if (packageName.length === 0 || fingerprintsRaw.length === 0) continue;
    apps.push({
      packageName,
      sha256Fingerprints: [fingerprintsRaw],
    });
  }
  return apps;
}

/**
 * Generate `/.well-known/webauthn` content (W3C WebAuthn Level 3).
 *
 * Declares alternative origins permitted to use this RP ID. Lets a passkey
 * registered at `app.example.com` work on `staging.example.com`, browser
 * extensions, or wrapped native webviews.
 *
 * Reads {@link WEBAUTHN_ALT_ORIGINS}; falls back to `SECONDARY_URL` parsed
 * from the existing site URL convention.
 */
export function generateWebAuthnConfig(opts?: {
  /** Override `WEBAUTHN_ALT_ORIGINS`. */
  origins?: string[];
}): WellKnownResponse | null {
  const explicit = opts?.origins;
  const fromEnv = parseList(envOptionalString("WEBAUTHN_ALT_ORIGINS"));
  const fromSecondary = parseList(envOptionalString("SECONDARY_URL")).map(normalizeUrl);
  const origins = explicit ?? (fromEnv.length > 0 ? fromEnv : fromSecondary);
  if (origins.length === 0) return null;

  const body = JSON.stringify({ origins });
  return ok(body, "application/json");
}

/**
 * Generate `/.well-known/security.txt` content (RFC 9116).
 *
 * Plain-text contact info for security researchers. Reads {@link SECURITY_CONTACT}
 * (e.g., `mailto:security@example.com` or `https://example.com/security`) and
 * optional {@link SECURITY_TXT_EXPIRES_DAYS} (default 365).
 */
export function generateSecurityTxt(opts?: {
  /** Override `SECURITY_CONTACT`. Should be a `mailto:` or `https:` URI. */
  contact?: string;
  /** Override `SECURITY_TXT_EXPIRES_DAYS`. Default 365 days from now. */
  expiresInDays?: number;
  /** RFC 5646 language tags, e.g., `["en"]`. */
  preferredLanguages?: string[];
  /** Optional canonical URL of the security.txt file (for signed copies). */
  canonical?: string;
  /** Optional public key URL for encrypted reports. */
  encryption?: string;
  /** Optional acknowledgments URL. */
  acknowledgments?: string;
  /** Optional policy URL. */
  policy?: string;
  /** Optional hiring URL. */
  hiring?: string;
}): WellKnownResponse | null {
  const contact = opts?.contact ?? envOptionalString("SECURITY_CONTACT");
  if (contact === undefined || contact.length === 0) return null;

  const days = opts?.expiresInDays ?? envOptionalNumber("SECURITY_TXT_EXPIRES_DAYS") ?? 365;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const lines: string[] = [`Contact: ${contact}`, `Expires: ${expires}`];

  const langs = opts?.preferredLanguages;
  if (langs && langs.length > 0) {
    lines.push(`Preferred-Languages: ${langs.join(", ")}`);
  }
  if (opts?.canonical) lines.push(`Canonical: ${opts.canonical}`);
  if (opts?.encryption) lines.push(`Encryption: ${opts.encryption}`);
  if (opts?.acknowledgments) lines.push(`Acknowledgments: ${opts.acknowledgments}`);
  if (opts?.policy) lines.push(`Policy: ${opts.policy}`);
  if (opts?.hiring) lines.push(`Hiring: ${opts.hiring}`);

  const body = `${lines.join("\n")}\n`;
  return ok(body, "text/plain; charset=utf-8");
}

/**
 * Generate a 302 redirect for `/.well-known/change-password` (RFC 8615).
 *
 * Password managers (1Password, iCloud Keychain, Bitwarden, Chrome) deep-link
 * here when the user picks "Change password". The route should redirect to
 * the actual change-password UI in your app.
 *
 * Reads {@link CHANGE_PASSWORD_URL}.
 */
export function generateChangePasswordRedirect(opts?: {
  /** Override `CHANGE_PASSWORD_URL`. */
  targetUrl?: string;
}): WellKnownResponse | null {
  const target = opts?.targetUrl ?? envOptionalString("CHANGE_PASSWORD_URL");
  if (target === undefined || target.length === 0) return null;
  return {
    status: 302,
    headers: {
      Location: target,
      "Cache-Control": "public, max-age=300",
    },
    body: "",
  };
}
