import type { FunctionReference } from "convex/server";

import type { ComponentApi } from "../component/_generated/component";

type LooseComponentRefs<T> = {
  [K in keyof T]: T[K] extends FunctionReference<infer Type, infer Visibility, any, any>
    ? FunctionReference<Type, Visibility>
    : LooseComponentRefs<T[K]>;
};

/**
 * The auth component's API surface, derived from the generated
 * `ComponentApi<"auth">`. Nesting and function kinds come from codegen
 * (so it never drifts), while args/returns stay loose at the call
 * boundary the generic server layer uses.
 */
export type AuthComponentApi = LooseComponentRefs<ComponentApi<"auth">>;
