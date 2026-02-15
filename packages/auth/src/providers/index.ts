/**
 * Provider exports for `@robelest/convex-auth/providers`.
 *
 * All non-OAuth providers are classes following the Arctic pattern.
 * OAuth providers are wrapped via the `OAuth()` factory which attaches
 * scopes and profile config to an Arctic provider instance.
 *
 * @module
 */

export { OAuth } from "./oauth";
export type { OAuthConfig } from "./oauth";
export { Password } from "./password";
export type { PasswordConfig } from "./password";
export { Passkey } from "./passkey";
export type { PasskeyConfig } from "./passkey";
export { Totp } from "./totp";
export type { TotpConfig } from "./totp";
export { Anonymous } from "./anonymous";
export type { AnonymousConfig } from "./anonymous";
export { Credentials } from "./credentials";
export type { CredentialsConfig } from "./credentials";
