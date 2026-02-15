/**
 * Anonymous authentication provider.
 *
 * ```ts
 * import { Anonymous } from "@robelest/convex-auth/providers";
 *
 * new Anonymous()
 * ```
 *
 * @module
 */

import { Credentials } from "./credentials";
import type {
  GenericActionCtxWithAuthConfig,
  ConvexCredentialsConfig,
} from "../server/types";
import {
  DocumentByName,
  GenericDataModel,
  WithoutSystemFields,
} from "convex/server";
import { Value } from "convex/values";

/**
 * The available options to an {@link Anonymous} provider for Convex Auth.
 */
export interface AnonymousConfig<DataModel extends GenericDataModel> {
  /**
   * Uniquely identifies the provider, allowing to use
   * multiple different {@link Anonymous} providers.
   */
  id?: string;
  /**
   * Perform checks on provided params and customize the user
   * information stored after sign in.
   */
  profile?: (
    /**
     * The values passed to the `signIn` function.
     */
    params: Record<string, Value | undefined>,
    /**
     * Convex ActionCtx in case you want to read from or write to
     * the database.
     */
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => WithoutSystemFields<DocumentByName<DataModel, "user">> & {
    isAnonymous: true;
  };
}

/**
 * Anonymous authentication provider.
 *
 * Creates a new anonymous user account without requiring any
 * user-provided information. Useful for guest access or
 * progressive profiling.
 *
 * @example
 * ```ts
 * import { Anonymous } from "@robelest/convex-auth/providers";
 *
 * new Anonymous()
 * ```
 */
export class Anonymous<DataModel extends GenericDataModel = GenericDataModel> {
  readonly id: string;
  readonly type = "credentials" as const;
  readonly config: AnonymousConfig<DataModel>;

  constructor(config: AnonymousConfig<DataModel> = {} as AnonymousConfig<DataModel>) {
    this.id = config.id ?? "anonymous";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): ConvexCredentialsConfig {
    const config = this.config;
    const provider = this.id;

    return new Credentials<DataModel>({
      id: "anonymous",
      authorize: async (params, ctx) => {
        const profile = config.profile?.(params, ctx) ?? { isAnonymous: true };
        const { user } = await ctx.auth.account.create(ctx, {
          provider,
          account: { id: crypto.randomUUID() },
          profile: profile as any,
        });
        return { userId: user._id };
      },
      ...config,
    })._toMaterialized();
  }
}

// ============================================================================
// Backward-compatible default export
// ============================================================================

/**
 * @deprecated Use `new Anonymous(config)` instead.
 */
export default function anonymous<DataModel extends GenericDataModel>(
  config: AnonymousConfig<DataModel> = {} as AnonymousConfig<DataModel>,
): ConvexCredentialsConfig {
  return new Anonymous(config)._toMaterialized();
}
