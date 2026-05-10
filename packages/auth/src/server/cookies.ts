import { readConfigSync, envOptionalString } from "./env";
import { isLocalHost } from "./url";

/** @internal */
export const SHARED_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "none" as const,
  secure: true,
  path: "/",
  partitioned: true,
};

// ============================================================================
// OAuth state encoding — encodes redirectTo into the state parameter so it
// survives redirect chains even when cookies are blocked (mobile webviews).
// ============================================================================

/** Encode a redirectTo URL into the OAuth state parameter. */
export function encodeOAuthState(state: string, redirectTo: string | null): string {
  if (redirectTo === null) return state;
  const json = JSON.stringify({ s: state, r: redirectTo });
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode an OAuth state parameter, extracting the original state and redirectTo. */
export function decodeOAuthState(encoded: string): { state: string; redirectTo: string | null } {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded));
    if (typeof json === "object" && json !== null && typeof json.s === "string") {
      return { state: json.s, redirectTo: typeof json.r === "string" ? json.r : null };
    }
  } catch {
    // Not encoded — plain state string (backward compat)
  }
  return { state: encoded, redirectTo: null };
}

const REDIRECT_MAX_AGE = 60 * 15; // 15 minutes in seconds
/** @internal */
export function redirectToParamCookie(providerId: string, redirectTo: string) {
  return {
    name: redirectToParamCookieName(providerId),
    value: redirectTo,
    options: { ...SHARED_COOKIE_OPTIONS, maxAge: REDIRECT_MAX_AGE },
  };
}

/** @internal */
export function useRedirectToParam(
  providerId: string,
  cookies: Record<string, string | undefined>,
) {
  const cookieName = redirectToParamCookieName(providerId);
  const redirectTo = cookies[cookieName];
  if (redirectTo === undefined) {
    return null;
  }

  // Clear the cookie
  const updatedCookie = {
    name: cookieName,
    value: "",
    options: { ...SHARED_COOKIE_OPTIONS, maxAge: 0 },
  };

  return { redirectTo, updatedCookie };
}

function redirectToParamCookieName(providerId: string) {
  const convexSiteUrl = readConfigSync(envOptionalString("CONVEX_SITE_URL"));
  return (!isLocalHost(convexSiteUrl ?? undefined) ? "__Host-" : "") + providerId + "RedirectTo";
}
