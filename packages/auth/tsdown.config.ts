import { defineConfig } from "vite-plus/pack";

const jsExtensions = () => ({ js: ".js", dts: ".d.ts" });

export default defineConfig([
  {
    entry: ["src/server/**/*.ts", "src/providers/**/*.ts"],
    format: "esm",
    outDir: "dist",
    dts: true,
    clean: true,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      "client/index": "src/client/index.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: true,
    clean: false,
    unbundle: true,
    platform: "browser",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      "authorization/index": "src/authorization/index.ts",
      test: "src/test.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: true,
    clean: false,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: ["src/component/**/*.ts"],
    format: "esm",
    outDir: "dist/component",
    dts: true,
    clean: false,
    unbundle: true,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
  {
    entry: {
      bin: "src/cli/bin.ts",
    },
    format: "esm",
    outDir: "dist",
    dts: false,
    clean: false,
    platform: "node",
    external: [/^convex/],
    outExtensions: jsExtensions,
  },
]);
