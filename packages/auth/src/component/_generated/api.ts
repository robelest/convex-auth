/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions from "../functions.js";
import type * as index from "../index.js";
import type * as model from "../model.js";
import type * as public_ from "../public.js";
import type * as public_enterprise from "../public/enterprise.js";
import type * as public_factors from "../public/factors.js";
import type * as public_groups from "../public/groups.js";
import type * as public_identity from "../public/identity.js";
import type * as public_keys from "../public/keys.js";
import type * as public_shared from "../public/shared.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  functions: typeof functions;
  index: typeof index;
  model: typeof model;
  public: typeof public_;
  "public/enterprise": typeof public_enterprise;
  "public/factors": typeof public_factors;
  "public/groups": typeof public_groups;
  "public/identity": typeof public_identity;
  "public/keys": typeof public_keys;
  "public/shared": typeof public_shared;
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

export const components = componentsGeneric() as unknown as {};
