import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../../convex"),
      "@robelest/convex-auth/test": path.resolve(__dirname, "../../packages/auth/src/test.ts"),
      "@robelest/convex-auth": path.resolve(__dirname, "../../packages/auth/src"),
    },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
