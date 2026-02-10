import { convexTest as baseConvexTest } from "convex-test";

export * from "convex-test";

export const convexTest: typeof baseConvexTest = (
  schema,
  modules = import.meta.glob("../convex/**/*.*s"),
) => baseConvexTest(schema, modules);
