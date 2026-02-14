/**
 * Structured error handling for Convex Auth.
 *
 * Every error thrown by the auth system uses `ConvexError` with a
 * `{ code, message }` payload so clients can distinguish error types
 * and display user-friendly messages.
 *
 * @module
 */

import { ConvexError } from "convex/values";

// ============================================================================
// Error code → default message map  (single source of truth)
// ============================================================================

export const AUTH_ERRORS = {
  // ---- Configuration ----
  PROVIDER_NOT_CONFIGURED:
    "This sign-in method is not available.",
  EMAIL_CONFIG_REQUIRED:
    "Email transport is not configured. Configure email in your Auth constructor.",
  MISSING_ENV_VAR:
    "A required server environment variable is missing.",
  MISSING_ACTION_CONTEXT:
    "Action context is required for this operation.",

  // ---- Authentication ----
  NOT_SIGNED_IN:
    "You must be signed in to perform this action.",
  INVALID_VERIFICATION_CODE:
    "Invalid or expired verification code.",
  INVALID_REFRESH_TOKEN:
    "Your session has expired. Please sign in again.",
  SIGN_IN_MISSING_PARAMS:
    "Cannot sign in: missing provider, code, or refresh token.",
  UNSUPPORTED_PROVIDER_TYPE:
    "This provider type is not supported.",
  INVALID_REDIRECT:
    "Invalid redirect URL.",

  // ---- Email / Phone ----
  EMAIL_SEND_FAILED:
    "Failed to send verification email. Please try again.",

  // ---- Portal ----
  PORTAL_NOT_AUTHORIZED:
    "This email does not have portal admin access. Ask an admin for an invite link.",
  PORTAL_UNKNOWN_ACTION:
    "Unknown portal action.",
  INVITE_TOKEN_REQUIRED:
    "Invite token is required.",
  INVALID_INVITE:
    "Invalid or expired invite token.",
  INVITE_ALREADY_USED:
    "This invite has already been used.",
  INVITE_EXPIRED:
    "This invite has expired.",

  // ---- API Keys ----
  INVALID_API_KEY:
    "Invalid API key.",
  API_KEY_REVOKED:
    "This API key has been revoked.",
  API_KEY_EXPIRED:
    "This API key has expired.",
  API_KEY_RATE_LIMITED:
    "API key rate limit exceeded. Please try again later.",
  API_KEY_INVALID_SCOPE:
    "Invalid scope requested for API key.",

  // ---- OAuth ----
  OAUTH_MISSING_PROVIDER:
    "Missing OAuth provider ID.",
  OAUTH_MISSING_VERIFIER:
    "Missing sign-in verifier.",
  OAUTH_INVALID_STATE:
    "Invalid OAuth state. Please try signing in again.",
  OAUTH_PROVIDER_ERROR:
    "The sign-in provider returned an error.",
  OAUTH_MISSING_ID_TOKEN:
    "ID token claims are missing from the provider response.",
  OAUTH_INVALID_PROFILE:
    "The sign-in provider returned an invalid profile.",
  OAUTH_UNSUPPORTED_AUTH_METHOD:
    "Unsupported OAuth client authentication method.",
  OAUTH_NO_USERINFO:
    "No userinfo endpoint configured for this provider.",

  // ---- Credentials ----
  ACCOUNT_ALREADY_EXISTS:
    "An account with these credentials already exists.",
  ACCOUNT_NOT_FOUND:
    "Account not found.",
  INVALID_CREDENTIALS_PROVIDER:
    "This provider does not support credential operations.",
  MISSING_CRYPTO_FUNCTION:
    "This provider is missing a required cryptographic function.",
  USER_UPDATE_FAILED:
    "Could not update the user record.",

  // ---- Verifier ----
  INVALID_VERIFIER:
    "Invalid or expired verifier.",

  // ---- Passkey ----
  PASSKEY_MISSING_CONFIG:
    "Passkey provider requires SITE_URL or explicit rpId configuration.",
  PASSKEY_AUTH_REQUIRED:
    "Sign in first, then add a passkey to your account.",
  PASSKEY_MISSING_VERIFIER:
    "Missing verifier for passkey operation.",
  PASSKEY_INVALID_CLIENT_DATA:
    "Invalid passkey client data.",
  PASSKEY_INVALID_ORIGIN:
    "Passkey origin does not match the expected value.",
  PASSKEY_INVALID_CHALLENGE:
    "Invalid or expired passkey challenge.",
  PASSKEY_RP_MISMATCH:
    "Relying party ID mismatch.",
  PASSKEY_USER_PRESENCE:
    "User presence flag not set.",
  PASSKEY_USER_VERIFICATION:
    "User verification required but not performed.",
  PASSKEY_NO_CREDENTIAL:
    "No credential in attestation.",
  PASSKEY_UNSUPPORTED_ALGORITHM:
    "Unsupported passkey algorithm.",
  PASSKEY_INVALID_SIGNATURE:
    "Invalid passkey signature.",
  PASSKEY_UNKNOWN_CREDENTIAL:
    "Unknown passkey credential.",
  PASSKEY_COUNTER_ERROR:
    "Authenticator counter did not increase — possible credential cloning detected.",
  PASSKEY_MISSING_FLOW:
    "Missing passkey flow parameter.",
  PASSKEY_UNKNOWN_FLOW:
    "Unknown passkey flow.",

  // ---- TOTP ----
  TOTP_AUTH_REQUIRED:
    "Sign in first, then set up two-factor authentication.",
  TOTP_MISSING_VERIFIER:
    "Missing verifier for TOTP operation.",
  TOTP_MISSING_CODE:
    "Missing TOTP code.",
  TOTP_MISSING_ID:
    "Missing TOTP enrollment ID.",
  TOTP_NOT_FOUND:
    "TOTP enrollment not found.",
  TOTP_ALREADY_VERIFIED:
    "TOTP enrollment is already verified.",
  TOTP_INVALID_CODE:
    "Invalid TOTP code.",
  TOTP_INVALID_VERIFIER:
    "Invalid or expired TOTP verifier.",
  TOTP_NO_ENROLLMENT:
    "No verified TOTP enrollment found.",
  TOTP_MISSING_FLOW:
    "Missing TOTP flow parameter.",
  TOTP_UNKNOWN_FLOW:
    "Unknown TOTP flow.",

  // ---- Internal (should never reach user) ----
  INTERNAL_ERROR:
    "An unexpected error occurred.",
} as const satisfies Record<string, string>;

export type AuthErrorCode = keyof typeof AUTH_ERRORS;

// ============================================================================
// Error helpers
// ============================================================================

/**
 * Throw a structured `ConvexError` with `{ code, message }`.
 *
 * @param code    Machine-readable error code from `AUTH_ERRORS`.
 * @param message Optional override for the default human-readable message.
 * @param context Optional extra fields merged into the error payload.
 */
export function throwAuthError(
  code: AuthErrorCode,
  message?: string,
  context?: Record<string, unknown>,
): never {
  throw new ConvexError({
    code,
    message: message ?? AUTH_ERRORS[code],
    ...context,
  });
}

/**
 * Type guard to check if a caught value is an auth `ConvexError`.
 */
export function isAuthError(
  error: unknown,
): error is ConvexError<{ code: AuthErrorCode; message: string }> {
  return (
    error instanceof ConvexError &&
    typeof error.data === "object" &&
    error.data !== null &&
    "code" in error.data &&
    "message" in error.data
  );
}

/**
 * Extract `{ code, message }` from a caught error.
 *
 * Works for both `ConvexError` (thrown by Convex actions) and plain
 * `Error` instances. Returns `null` if the value isn't an error.
 *
 * Useful on the client to normalize error handling:
 *
 * ```ts
 * try {
 *   await auth.signIn("email", { email });
 * } catch (e) {
 *   const err = parseAuthError(e);
 *   if (err?.code === "EMAIL_SEND_FAILED") { ... }
 * }
 * ```
 */
export function parseAuthError(
  error: unknown,
): { code: AuthErrorCode; message: string } | { code: null; message: string } | null {
  if (isAuthError(error)) {
    const { code, message } = error.data as { code: AuthErrorCode; message: string };
    return { code, message };
  }
  if (error instanceof ConvexError && typeof error.data === "string") {
    return { code: null, message: error.data };
  }
  if (error instanceof Error) {
    return { code: null, message: error.message };
  }
  return null;
}
