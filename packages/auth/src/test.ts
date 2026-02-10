import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

type ImportMetaWithGlob = ImportMeta & {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
};

const modules = (import.meta as ImportMetaWithGlob).glob(
  "./component/**/*.ts",
);

export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "auth",
) {
  t.registerComponent(name, schema, modules);
}

export default {
  register,
  schema,
  modules,
};
