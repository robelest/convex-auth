/**
 * Credentials provider for custom authentication flows.
 *
 * ```ts
 * import { credentials } from "@robelest/convex-auth/providers";
 *
 * credentials({
 *   authorize: async (credentials, ctx) => {
 *     // Your custom logic here...
 *   },
 * })
 * ```
 *
 * @module
 */

import { GenericDataModel } from "convex/server";
import { GenericId, Value } from "convex/values";

import type {
  AuthProviderConfig,
  ConvexCredentialsConfig,
  GenericActionCtxWithAuthConfig,
} from "../server/types";

/** Configuration for the {@link credentials} provider. */
export interface CredentialsConfig<
  DataModel extends GenericDataModel = GenericDataModel,
> {
  id?: string;
  authorize: (
    credentials: Partial<Record<string, Value | undefined>>,
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => Promise<{
    userId: GenericId<"User">;
    sessionId?: GenericId<"Session">;
  } | null>;
  crypto?: {
    hashSecret: (secret: string) => Promise<string>;
    verifySecret: (secret: string, hash: string) => Promise<boolean>;
  };
  extraProviders?: (AuthProviderConfig | undefined)[];
}

/**
 * Create a credentials provider for custom sign-in logic.
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Custom authorization and hashing hooks.
 * @returns A configured credentials provider for `createAuth`.
 *
 * @example
 * ```ts
 * import { credentials } from "@robelest/convex-auth/providers";
 *
 * credentials({
 *   authorize: async (params, ctx) => {
 *     const user = await lookupUser(params.email, params.password, ctx);
 *     return user ? { userId: user._id } : null;
 *   },
 * })
 * ```
 */
export function credentials<
  DataModel extends GenericDataModel = GenericDataModel,
>(config: CredentialsConfig<DataModel>): ConvexCredentialsConfig {
  return {
    ...config,
    id: config.id ?? "credentials",
    type: "credentials",
  } as ConvexCredentialsConfig;
}
