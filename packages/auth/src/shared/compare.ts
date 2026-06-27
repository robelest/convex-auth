/**
 * Constant-time comparisons for secret material.
 *
 * @module
 */

/**
 * Constant-time comparison for hex-encoded strings (e.g. SHA-256 hashes).
 *
 * Returns `false` for differing lengths and otherwise compares every character
 * without short-circuiting, so timing does not reveal how much of the input
 * matched.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
