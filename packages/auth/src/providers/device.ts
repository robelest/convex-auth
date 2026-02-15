/**
 * Device authorization provider (RFC 8628).
 *
 * Enables input-constrained devices (CLIs, TVs, IoT) to authenticate
 * by displaying a short code that the user enters on a secondary device.
 *
 * ```ts
 * import { Device } from "@robelest/convex-auth/providers";
 *
 * new Device()
 * ```
 *
 * @module
 */

import type { DeviceProviderConfig } from "../server/types";

/**
 * Configuration for the Device authorization provider.
 */
export interface DeviceConfig {
  /**
   * User code character set.
   * Default: `"BCDFGHJKLMNPQRSTVWXZ"` (base-20, no vowels per RFC 8628 §6.1).
   */
  charset?: string;
  /** User code length (before formatting). Default: 8. */
  userCodeLength?: number;
  /** Device code + user code lifetime in seconds. Default: 900 (15 min). */
  expiresIn?: number;
  /** Minimum polling interval in seconds. Default: 5. */
  interval?: number;
  /**
   * Base URL for the verification page where users enter the device code.
   *
   * Example: `"http://localhost:3000/device"` or `"https://myapp.com/device"`.
   *
   * If not provided, falls back to `SITE_URL + "/device"`.
   */
  verificationUri?: string;
}

/** No-vowel base-20 charset per RFC 8628 §6.1 recommendation. */
const DEFAULT_CHARSET = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * Device authorization provider (RFC 8628).
 *
 * Enables input-constrained devices (CLIs, TVs, IoT) to authenticate
 * by displaying a short user code. The user visits a verification page
 * on a secondary device, signs in with any existing provider, and
 * enters the code to authorize the device.
 *
 * @example
 * ```ts
 * import { Device } from "@robelest/convex-auth/providers";
 *
 * const auth = new Auth(components.auth, {
 *   providers: [new Device()],
 * });
 * ```
 */
export class Device {
  readonly id: string;
  readonly type = "device" as const;
  readonly config: DeviceConfig;

  constructor(config: DeviceConfig = {}) {
    this.id = "device";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): DeviceProviderConfig {
    return {
      id: this.id,
      type: "device",
      charset: this.config.charset ?? DEFAULT_CHARSET,
      userCodeLength: this.config.userCodeLength ?? 8,
      expiresIn: this.config.expiresIn ?? 900,
      interval: this.config.interval ?? 5,
      verificationUri: this.config.verificationUri,
    };
  }
}

// ============================================================================
// Backward-compatible default export
// ============================================================================

/**
 * @deprecated Use `new Device(config)` instead.
 */
export default function device(
  config?: DeviceConfig,
): DeviceProviderConfig {
  return new Device(config)._toMaterialized();
}
