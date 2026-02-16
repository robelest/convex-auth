import { defineConfig } from "tsdown";

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
]);
