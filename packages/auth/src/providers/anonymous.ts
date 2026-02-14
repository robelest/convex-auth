/**
 * Configure {@link anonymous} provider given an {@link AnonymousConfig}.
 *
 * ```ts
 * import anonymous from "@robelest/convex-auth/providers/anonymous";
 * import { Auth } from "@robelest/convex-auth/component";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   providers: [anonymous],
 * });
 * ```
 *
 * @module
 */

import credentials from "@robelest/convex-auth/providers/credentials";
import {
  GenericActionCtxWithAuthConfig,
} from "@robelest/convex-auth/component";
import {
  DocumentByName,
  GenericDataModel,
  WithoutSystemFields,
} from "convex/server";
import { Value } from "convex/values";

/**
 * The available options to an {@link anonymous} provider for Convex Auth.
 */
export interface AnonymousConfig<DataModel extends GenericDataModel> {
  /**
   * Uniquely identifies the provider, allowing to use
   * multiple different {@link anonymous} providers.
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
 * An anonymous authentication provider.
 *
 * This provider doesn't require any user-provided information.
 *
 * @param config - Optional overrides (custom ID, profile, etc.).
 * @returns A `ConvexCredentialsConfig` to include in your `providers` array.
 */
export default function anonymous<DataModel extends GenericDataModel>(
  config: AnonymousConfig<DataModel> = {},
) {
  const provider = config.id ?? "anonymous";
  return credentials<DataModel>({
    id: "anonymous",
    authorize: async (params, ctx) => {
      const profile = config.profile?.(params, ctx) ?? { isAnonymous: true };
      const { user } = await ctx.auth.account.create(ctx, {
        provider,
        account: { id: crypto.randomUUID() },
        profile: profile as any,
      });
      // END
      return { userId: user._id };
    },
    ...config,
  });
}
