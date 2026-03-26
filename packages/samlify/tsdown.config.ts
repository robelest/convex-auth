import { defineConfig } from "vite-plus/pack";

const jsExtensions = () => ({ js: ".js", dts: ".d.ts" });

export default defineConfig({
  entry: ["index.ts", "src/**/*.ts"],
  format: "esm",
  outDir: "dist",
  dts: true,
  clean: true,
  unbundle: true,
  outExtensions: jsExtensions,
});
