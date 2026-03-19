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
export { Device } from "./device";
export type { DeviceConfig } from "./device";
export { SSO } from "./sso";
export { Email } from "./email";
export type { EmailProviderConfig } from "./email";
export type { EmailConfig } from "../server/types";
export { Phone } from "./phone";
export type { PhoneProviderConfig } from "./phone";
export type { PhoneConfig } from "../server/types";
