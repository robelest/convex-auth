/**
 * TOTP (Time-based One-Time Password) two-factor authentication provider.
 *
 * ```ts
 * import { Totp } from "@robelest/convex-auth/providers";
 *
 * new Totp({ issuer: "My App" })
 * ```
 *
 * @module
 */

import type { TotpProviderConfig } from "../server/types";

/**
 * Configuration for the TOTP provider.
 */
export interface TotpConfig {
  /** Issuer name shown in authenticator apps (e.g. "My App"). */
  issuer?: string;
  /** Number of digits in each code (default: 6). */
  digits?: number;
  /** Time period in seconds for code rotation (default: 30). */
  period?: number;
}

/**
 * TOTP (Time-based One-Time Password) two-factor authentication provider.
 *
 * Generates time-based one-time passwords compatible with authenticator
 * apps like Google Authenticator and Authy.
 *
 * @example
 * ```ts
 * import { Totp } from "@robelest/convex-auth/providers";
 *
 * new Totp({ issuer: "My App" })
 * ```
 */
export class Totp {
  readonly id: string;
  readonly type = "totp" as const;
  readonly config: TotpConfig;

  constructor(config: TotpConfig = {}) {
    this.id = "totp";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): TotpProviderConfig {
    return {
      id: this.id,
      type: "totp",
      options: {
        issuer: this.config.issuer ?? "ConvexAuth",
        digits: this.config.digits ?? 6,
        period: this.config.period ?? 30,
      },
    };
  }
}

// ============================================================================
// Backward-compatible default export
// ============================================================================

/**
 * @deprecated Use `new Totp(config)` instead.
 */
export default function totp(
  config?: TotpConfig,
): TotpProviderConfig {
  return new Totp(config)._toMaterialized();
}
