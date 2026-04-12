import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import modules from "./component/modules";
import schema from "./component/schema";

/**
 * Register the Convex Auth component in a `convex-test` environment.
 *
 * Use this in tests to mount the bundled auth component under a chosen
 * component name before invoking its functions.
 *
 * @param t - The `convex-test` test harness.
 * @param name - Component mount name. Defaults to `"auth"`.
 * @returns Nothing.
 *
 * @example
 * ```ts
 * import { convexTest } from "convex-test";
 * import { register } from "@robelest/convex-auth/test";
 *
 * const t = convexTest(schema);
 * register(t);
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "auth",
) {
  t.registerComponent(name, schema, modules);
}

const testHelpers: {
  register: typeof register;
  schema: SchemaDefinition<GenericSchema, boolean>;
  modules: Record<string, () => Promise<unknown>>;
} = {
  register,
  schema,
  modules,
};

/**
 * Test helpers bundled for `convex-test` setups.
 *
 * Exposes the auth component `schema`, lazily discovered `modules`, and the
 * `register()` helper as a convenience default export.
 */
export default testHelpers;
