/**
 * Passkey (WebAuthn) authentication provider.
 *
 * ```ts
 * import { Passkey } from "@robelest/convex-auth/providers";
 *
 * new Passkey({ rpName: "My App" })
 * ```
 *
 * @module
 */

import type { PasskeyProviderConfig } from "../server/types";

/**
 * Configuration for the Passkey provider.
 */
export interface PasskeyConfig {
  /** Relying Party display name. Defaults to SITE_URL hostname. */
  rpName?: string;
  /** Relying Party ID (hostname). Defaults to SITE_URL hostname. */
  rpId?: string;
  /** Allowed origins for credential verification. Defaults to SITE_URL. */
  origin?: string | string[];
  /** Attestation conveyance preference. Defaults to "none". */
  attestation?: "none" | "direct";
  /** User verification requirement. Defaults to "required". */
  userVerification?: "required" | "preferred" | "discouraged";
  /** Resident key (discoverable credential) preference. Defaults to "preferred". */
  residentKey?: "required" | "preferred" | "discouraged";
  /** Restrict to platform or cross-platform authenticators. */
  authenticatorAttachment?: "platform" | "cross-platform";
  /** Supported COSE algorithms. Defaults to [-7 (ES256), -257 (RS256)]. */
  algorithms?: number[];
  /** Challenge expiration in ms. Defaults to 300_000 (5 minutes). */
  challengeExpirationMs?: number;
}

/**
 * Passkey (WebAuthn) authentication provider.
 *
 * Enables passwordless authentication via biometrics, security keys,
 * and synced passkeys using the Web Authentication API.
 *
 * @example
 * ```ts
 * import { Passkey } from "@robelest/convex-auth/providers";
 *
 * new Passkey({ rpName: "My App" })
 * ```
 */
export class Passkey {
  readonly id: string;
  readonly type = "passkey" as const;
  readonly config: PasskeyConfig;

  constructor(config: PasskeyConfig = {}) {
    this.id = "passkey";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): PasskeyProviderConfig {
    return {
      id: this.id,
      type: "passkey",
      options: {
        attestation: "none",
        userVerification: "required",
        residentKey: "preferred",
        algorithms: [-7, -257], // ES256, RS256
        challengeExpirationMs: 300_000, // 5 minutes
        ...this.config,
      },
    };
  }
}

// ============================================================================
// Backward-compatible default export
// ============================================================================

/**
 * @deprecated Use `new Passkey(config)` instead.
 */
export default function passkey(
  config?: PasskeyConfig,
): PasskeyProviderConfig {
  return new Passkey(config)._toMaterialized();
}
