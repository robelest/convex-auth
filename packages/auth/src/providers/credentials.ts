/**
 * Credentials provider for custom authentication flows.
 *
 * ```ts
 * import { Credentials } from "@robelest/convex-auth/providers";
 *
 * new Credentials({
 *   authorize: async (credentials, ctx) => {
 *     // Your custom logic here...
 *   },
 * })
 * ```
 *
 * @module
 */

import {
  AuthProviderConfig,
  ConvexCredentialsConfig,
  GenericActionCtxWithAuthConfig,
} from "@robelest/convex-auth/component";
import { GenericDataModel } from "convex/server";
import { GenericId, Value } from "convex/values";

/**
 * Configuration for the Credentials provider.
 */
export interface CredentialsConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> {
  /** Uniquely identifies the provider. Defaults to `"credentials"`. */
  id?: string;
  /**
   * Handle credentials received from the client-side `signIn` call.
   *
   * @returns A user ID for successful login, or `null` to reject.
   */
  authorize: (
    credentials: Partial<Record<string, Value | undefined>>,
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => Promise<{
    userId: GenericId<"user">;
    sessionId?: GenericId<"session">;
  } | null>;
  /**
   * Provide hashing and verification functions for account secrets.
   */
  crypto?: {
    hashSecret: (secret: string) => Promise<string>;
    verifySecret: (secret: string, hash: string) => Promise<boolean>;
  };
  /**
   * Extra providers used internally (e.g. email verification in password flow).
   * Not exposed to clients.
   */
  extraProviders?: (AuthProviderConfig | undefined)[];
}

/**
 * Credentials provider for custom authentication flows.
 *
 * This is the escape hatch for fully custom auth logic. For email/password
 * flows, use the `Password` class instead.
 *
 * @example
 * ```ts
 * import { Credentials } from "@robelest/convex-auth/providers";
 *
 * new Credentials({
 *   authorize: async (credentials, ctx) => {
 *     const user = await validateUser(credentials);
 *     return user ? { userId: user._id } : null;
 *   },
 * })
 * ```
 */
export class Credentials<DataModel extends GenericDataModel = GenericDataModel> {
  readonly id: string;
  readonly type = "credentials" as const;
  readonly config: CredentialsConfig<DataModel>;

  constructor(config: CredentialsConfig<DataModel>) {
    this.id = config.id ?? "credentials";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): ConvexCredentialsConfig {
    return {
      ...this.config,
      id: this.id,
      type: "credentials",
    } as ConvexCredentialsConfig;
  }
}

// Keep the old factory function as default export for backward compatibility
// during the transition. New code should use `new Credentials(...)`.

/** @deprecated Use `new Credentials(config)` instead. */
export default function credentials<DataModel extends GenericDataModel>(
  config: CredentialsConfig<DataModel>,
): ConvexCredentialsConfig {
  return new Credentials(config)._toMaterialized();
}

// Re-export the old type name for backward compat
export type CredentialsUserConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> = CredentialsConfig<DataModel>;
