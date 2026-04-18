import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import type { Value } from "convex/values";

/**
 * Internal function reference for the library's store dispatch mutation.
 *
 * The package cannot import the consumer app's generated `api` module,
 * so it uses a canonical function reference name that matches the app-level
 * `export const { store } = auth` surface.
 */
export const AUTH_STORE_REF = makeFunctionReference("auth:store") as unknown as FunctionReference<
  "mutation",
  "public",
  Record<string, Value>,
  unknown
>;
