/**
 * Device authorization provider (RFC 8628).
 *
 * Enables input-constrained devices (CLIs, TVs, IoT) to authenticate
 * by displaying a short code that the user enters on a secondary device.
 *
 * ```ts
 * import { device } from "@robelest/convex-auth/providers";
 *
 * device()
 * ```
 *
 * @module
 */

import type { DeviceProviderConfig } from "../server/types";

/** Configuration for the {@link device} provider. */
export interface DeviceConfig {
  charset?: string;
  userCodeLength?: number;
  expiresIn?: number;
  interval?: number;
  verificationUri?: string;
}

const DEFAULT_CHARSET = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * Create a device authorization provider.
 *
 * @param config - Optional device flow code and polling settings.
 * @returns A configured device flow provider for `createAuth`.
 *
 * @example
 * ```ts
 * import { device } from "@robelest/convex-auth/providers";
 *
 * device({ verificationUri: "https://example.com/device" })
 * ```
 */
export function device(config: DeviceConfig = {}): DeviceProviderConfig {
  return {
    id: "device",
    type: "device",
    charset: config.charset ?? DEFAULT_CHARSET,
    userCodeLength: config.userCodeLength ?? 8,
    expiresIn: config.expiresIn ?? 900,
    interval: config.interval ?? 5,
    verificationUri: config.verificationUri,
  };
}
