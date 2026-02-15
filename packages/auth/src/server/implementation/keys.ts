/**
 * API Key crypto utilities.
 *
 * Uses `@oslojs/crypto` primitives for key generation and hashing:
 * - SHA-256 for hashing keys (API keys have high entropy, no need for bcrypt)
 * - Cryptographically secure random generation for key material
 *
 * @module
 */

import { sha256, generateRandomString } from "./utils.js";
import type { KeyScope, ScopeChecker } from "../types.js";
import { throwAuthError } from "../errors.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_KEY_PREFIX = "sk_live_";
const KEY_RANDOM_LENGTH = 32;
const KEY_RANDOM_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * How many characters of the full key to store as the visible prefix.
 * Includes the prefix string (e.g. "sk_live_") plus a few random chars.
 */
const VISIBLE_PREFIX_EXTRA_CHARS = 4;

// ============================================================================
// Key generation
// ============================================================================

/**
 * Generate a new API key.
 *
 * Returns the raw key (to be shown once to the user) and metadata for storage.
 * The raw key is `{prefix}{32 random alphanumeric chars}`.
 *
 * @param prefix - Key prefix, defaults to "sk_live_"
 * @returns `{ raw, hashedKey, displayPrefix }`
 */
export async function generateApiKey(prefix: string = DEFAULT_KEY_PREFIX): Promise<{
  /** The full raw key — show to user once, never store. */
  raw: string;
  /** SHA-256 hex hash of the raw key — store this. */
  hashedKey: string;
  /** Truncated prefix for display (e.g. "sk_live_aBc1..."). */
  displayPrefix: string;
}> {
  const randomPart = generateRandomString(KEY_RANDOM_LENGTH, KEY_RANDOM_ALPHABET);
  const raw = `${prefix}${randomPart}`;
  const hashedKey = await sha256(raw);
  const displayPrefix = `${raw.substring(0, prefix.length + VISIBLE_PREFIX_EXTRA_CHARS)}...`;

  return { raw, hashedKey, displayPrefix };
}

/**
 * Hash a raw API key for lookup.
 *
 * Used during Bearer token verification to find the stored key record.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  return sha256(rawKey);
}

// ============================================================================
// Scope checker
// ============================================================================

/**
 * Build a `ScopeChecker` from an array of `KeyScope` entries.
 *
 * The checker provides a `.can(resource, action)` method that returns `true`
 * if any scope entry grants the requested permission.
 *
 * A wildcard action `"*"` grants all actions on that resource.
 * A wildcard resource `"*"` grants the action on all resources.
 */
export function buildScopeChecker(scopes: KeyScope[]): ScopeChecker {
  return {
    scopes,
    can(resource: string, action: string): boolean {
      return scopes.some(
        (scope) =>
          (scope.resource === resource || scope.resource === "*") &&
          (scope.actions.includes(action) || scope.actions.includes("*")),
      );
    },
  };
}

/**
 * Validate that requested scopes are a subset of the allowed scopes
 * defined in the API key config.
 *
 * @param requested - Scopes the user wants on the new key.
 * @param allowed - The scope definition from `apiKeys.scopes` config.
 * @throws Error if any requested scope is not in the allowed set.
 */
export function validateScopes(
  requested: KeyScope[],
  allowed: Record<string, string[]> | undefined,
): void {
  if (!allowed) {
    // No scope restrictions configured — allow anything.
    return;
  }

  for (const scope of requested) {
    const allowedActions = allowed[scope.resource];
    if (!allowedActions) {
      throwAuthError(
        "API_KEY_INVALID_SCOPE",
        `Unknown resource "${scope.resource}" in API key scopes. Allowed resources: ${Object.keys(allowed).join(", ")}`,
      );
    }
    for (const action of scope.actions) {
      if (action !== "*" && !allowedActions.includes(action)) {
        throwAuthError(
          "API_KEY_INVALID_SCOPE",
          `Unknown action "${action}" for resource "${scope.resource}". Allowed actions: ${allowedActions.join(", ")}`,
        );
      }
    }
  }
}

// ============================================================================
// Per-key rate limiting (token-bucket)
// ============================================================================

/**
 * Check whether a key is rate-limited based on its stored state.
 *
 * Uses the same token-bucket algorithm as sign-in rate limiting:
 * tokens refill linearly over the configured window.
 *
 * @returns `{ limited: boolean; newState: { attemptsLeft, lastAttemptTime } }`
 */
export function checkKeyRateLimit(
  rateLimit: { maxRequests: number; windowMs: number },
  state: { attemptsLeft: number; lastAttemptTime: number } | undefined,
): {
  limited: boolean;
  newState: { attemptsLeft: number; lastAttemptTime: number };
} {
  const now = Date.now();

  if (!state) {
    // First request — create initial state with one token consumed.
    return {
      limited: false,
      newState: {
        attemptsLeft: rateLimit.maxRequests - 1,
        lastAttemptTime: now,
      },
    };
  }

  const elapsed = now - state.lastAttemptTime;
  const refillRate = rateLimit.maxRequests / rateLimit.windowMs;
  const refilled = Math.min(
    rateLimit.maxRequests,
    state.attemptsLeft + elapsed * refillRate,
  );

  if (refilled < 1) {
    return {
      limited: true,
      newState: {
        attemptsLeft: refilled,
        lastAttemptTime: now,
      },
    };
  }

  return {
    limited: false,
    newState: {
      attemptsLeft: refilled - 1,
      lastAttemptTime: now,
    },
  };
}
