/** Base URL for the hosted auth portal CDN. */
export const CDN_PORTAL_BASE = "https://convex-auth.pages.dev";

/**
 * Extract the deployment slug from a Convex cloud URL.
 *
 * @example
 * extractSlug("https://rapid-cat-62.convex.cloud") // "rapid-cat-62"
 */
export function extractSlug(convexCloudUrl: string): string | null {
  const match = convexCloudUrl.match(/^https?:\/\/([^.]+)\.convex\.cloud/);
  return match?.[1] ?? null;
}

/** Build the hosted portal URL from a Convex cloud URL. */
export function buildCdnPortalUrl(
  convexCloudUrl: string | undefined,
): string | null {
  if (!convexCloudUrl) return null;
  const slug = extractSlug(convexCloudUrl);
  return slug ? `${CDN_PORTAL_BASE}/${slug}` : null;
}
