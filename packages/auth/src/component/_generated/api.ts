/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as index from "../index.js";
import type * as portalBridge from "../portalBridge.js";
import type * as public_ from "../public.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  index: typeof index;
  portalBridge: typeof portalBridge;
  public: typeof public_;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {
  selfHosting: {
    lib: {
      gcOldAssets: FunctionReference<
        "mutation",
        "internal",
        { currentDeploymentId: string },
        { blobIds: Array<string>; storageIds: Array<string> }
      >;
      generateUploadUrl: FunctionReference<"mutation", "internal", {}, string>;
      getByPath: FunctionReference<
        "query",
        "internal",
        { path: string },
        {
          _creationTime: number;
          _id: string;
          blobId?: string;
          contentType: string;
          deploymentId: string;
          path: string;
          storageId?: string;
        } | null
      >;
      getCurrentDeployment: FunctionReference<
        "query",
        "internal",
        {},
        {
          _creationTime: number;
          _id: string;
          currentDeploymentId: string;
          deployedAt: number;
        } | null
      >;
      listAssets: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          blobId?: string;
          contentType: string;
          deploymentId: string;
          path: string;
          storageId?: string;
        }>
      >;
      recordAsset: FunctionReference<
        "mutation",
        "internal",
        {
          blobId?: string;
          contentType: string;
          deploymentId: string;
          path: string;
          storageId?: string;
        },
        { oldBlobId: string | null; oldStorageId: string | null }
      >;
      setCurrentDeployment: FunctionReference<
        "mutation",
        "internal",
        { deploymentId: string },
        null
      >;
    };
  };
};
