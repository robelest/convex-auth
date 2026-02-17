/// <reference types="vite/client" />

import { convexTest as baseConvexTest } from "convex-test";
import authTest from "@robelest/convex-auth/test";
import resendTest from "@convex-dev/resend/test";

export * from "convex-test";

export const convexTest: typeof baseConvexTest = (
  schema,
  modules = import.meta.glob("../../convex/**/*.*s"),
) => {
  const t = baseConvexTest(schema, modules);
  authTest.register(t as any, "auth");
  resendTest.register(t as any, "resend");
  return t;
};
