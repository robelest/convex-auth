/**
 * Passkey (WebAuthn) authentication provider.
 *
 * ```ts
 * import { passkey } from "@robelest/convex-auth/providers";
 *
 * passkey({ rpName: "My App" })
 * ```
 *
 * @module
 */

import type { PasskeyProviderConfig } from "../server/types";

/** Configuration for the {@link passkey} provider. */
export interface PasskeyConfig {
  rpName?: string;
  rpId?: string;
  origin?: string | string[];
  attestation?: "none" | "direct";
  userVerification?: "required" | "preferred" | "discouraged";
  residentKey?: "required" | "preferred" | "discouraged";
  authenticatorAttachment?: "platform" | "cross-platform";
  algorithms?: number[];
  challengeExpirationMs?: number;
}

/**
 * Create a passkey provider.
 *
 * @param config - Optional WebAuthn relying party and challenge settings.
 * @returns A configured passkey provider for `createAuth`.
 *
 * @example
 * ```ts
 * import { passkey } from "@robelest/convex-auth/providers";
 *
 * passkey({ rpName: "My App" })
 * ```
 */
export function passkey(config: PasskeyConfig = {}): PasskeyProviderConfig {
  return {
    id: "passkey",
    type: "passkey",
    options: {
      attestation: "none",
      userVerification: "required",
      residentKey: "preferred",
      algorithms: [-7, -257],
      challengeExpirationMs: 300_000,
      ...config,
    },
  };
}
