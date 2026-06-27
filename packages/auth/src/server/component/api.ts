import type { ComponentApi } from "../../component/_generated/component";

/**
 * The auth component's API surface — the full generated `ComponentApi<"auth">`,
 * with argument and return validators intact. Nesting and function kinds come
 * from codegen, so it never drifts from the component. The loose
 * `runQuery`/`runMutation` casts in the generic server layer are a local
 * convenience at those call sites, not an erasure baked into this type.
 */
export type AuthComponentApi = ComponentApi<"auth">;

/**
 * Narrow an overloaded `get` result — `Doc | (Doc | null)[] | null` — to a
 * single `Doc | null`. Use at call sites that pass a single selector to a
 * `get` whose return validator unions the single and batch shapes.
 */
export function single<T>(result: T | (T | null)[] | null): T | null {
  return Array.isArray(result) ? (result[0] ?? null) : result;
}
