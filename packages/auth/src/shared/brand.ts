/**
 * Nominal ("branded") types. `Brand<string, "X">` is a `string` at runtime but
 * is only assignable FROM a `string` via an explicit cast, so the compiler
 * stops you from mixing values that share a primitive shape but not a meaning —
 * an access token vs a refresh token, a raw secret vs its hash, a user-supplied
 * code vs an internal one. Brands erase at runtime (zero cost).
 *
 * @module
 */

declare const brand: unique symbol;

/** Tag a base type `T` with a compile-time-only nominal `Tag`. */
export type Brand<T, Tag extends string> = T & { readonly [brand]: Tag };

/** Opaque JWT access token. */
export type AccessToken = Brand<string, "AccessToken">;

/** Opaque encoded refresh token — `${refreshTokenId}|${sessionId}`. */
export type RefreshToken = Brand<string, "RefreshToken">;

/**
 * A one-way hash of some plaintext `TOf` (e.g. `Hashed<"Password">`,
 * `Hashed<"ApiKeySecret">`, `Hashed<"VerificationCode">`). Distinct from the
 * plaintext it was derived from so the two can't be swapped at a boundary.
 */
export type Hashed<TOf extends string> = Brand<string, `Hashed:${TOf}`>;

/** Raw, shown-once API key secret (the plaintext handed to the caller). */
export type ApiKeySecret = Brand<string, "ApiKeySecret">;

/** AES-GCM ciphertext produced by `encryptSecret` (`${iv}.${payload}`). */
export type EncryptedSecret = Brand<string, "EncryptedSecret">;

/** A user-supplied email/phone verification (OTP) code, in plaintext. */
export type VerificationCode = Brand<string, "VerificationCode">;

/**
 * Exhaustiveness guard for discriminated unions. Put it in the `default`
 * branch (or after an `if`/`switch` chain) so adding a new variant becomes a
 * compile error until every case is handled.
 */
export function assertNever(value: never, message = "Unhandled case"): never {
  throw new Error(`${message}: ${String(value)}`);
}
