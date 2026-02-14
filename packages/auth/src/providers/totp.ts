/**
 * TOTP (Time-based One-Time Password) two-factor authentication provider.
 *
 * @module
 */

import { TotpProviderConfig } from "../server/types.js";

/**
 * Add TOTP (Time-based One-Time Password) authentication.
 *
 * ```ts
 * import TOTP from "@robelest/convex-auth/providers/totp";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   providers: [TOTP({ issuer: "My App" })],
 * });
 * ```
 *
 * @param config - TOTP options: issuer name, digit count, and period.
 * @returns A `TotpProviderConfig` to include in your `providers` array.
 */
export default function totp(
  config?: Partial<TotpProviderConfig["options"]>,
): TotpProviderConfig {
  return {
    id: "totp",
    type: "totp",
    options: {
      issuer: config?.issuer ?? "ConvexAuth",
      digits: config?.digits ?? 6,
      period: config?.period ?? 30,
    },
  };
}
