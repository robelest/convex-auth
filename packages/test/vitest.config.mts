import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../../convex"),
      "@robelest/convex-auth/test": path.resolve(
        __dirname,
        "../../packages/auth/src/test.ts",
      ),
      "@robelest/convex-auth": path.resolve(__dirname, "../../packages/auth/src"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    testTimeout: 10000,
  },
});
