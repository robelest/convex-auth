import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../../convex"),
      "@convex-dev/auth/test": path.resolve(__dirname, "../../packages/auth/src/test.ts"),
      "@convex-dev/auth": path.resolve(__dirname, "../../packages/auth/dist"),
    },
  },
  test: {
    environment: "edge-runtime",
    testTimeout: 10000,
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
