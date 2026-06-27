/**
 * Extract a bearer token from an HTTP `Authorization` header.
 *
 * @module
 */

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Return the bearer token carried in a request's `Authorization` header, or
 * `null` when the header is absent or does not use the `Bearer` scheme.
 *
 * The scheme is matched case-insensitively per RFC 6750, and the captured
 * token is trimmed of surrounding whitespace.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null) {
    return null;
  }
  const match = BEARER_PATTERN.exec(header);
  return match ? match[1].trim() : null;
}
