/**
 * Flat public component namespace for `components.auth.public.*` references.
 *
 * The implementation files under `./public/**` stay grouped by domain for
 * maintainability, while this module preserves the single flat component API
 * surface consumed by the auth runtime and app code.
 */
export * from "./public/factors/devices";
export * from "./public/sso/audit";
export * from "./public/sso/core";
export * from "./public/sso/domains";
export * from "./public/sso/scim";
export * from "./public/sso/secrets";
export * from "./public/sso/webhooks";
export * from "./public/groups/core";
export * from "./public/groups/invites";
export * from "./public/groups/members";
export * from "./public/factors/passkeys";
export * from "./public/factors/totp";
