import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../convex"),
    },
  },
  test: {
    environment: "edge-runtime",
    testTimeout: 10000,
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
