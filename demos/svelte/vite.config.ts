import path from "node:path";

import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const convexRoot = path.resolve(import.meta.dirname, "../../convex");
const rootEnvDir = path.resolve(import.meta.dirname, "../..");

Object.assign(process.env, loadEnv(process.env.NODE_ENV ?? "development", rootEnvDir, ""));

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, rootEnvDir, ""));

  return {
    plugins: [tailwindcss(), sveltekit()],
    ssr: { noExternal: ["svelte-sonner"] },
    envDir: rootEnvDir,
    envPrefix: ["PUBLIC_", "VITE_", "CONVEX_", "AUTH_", "APP_"],
    resolve: {
      alias: [
        {
          find: "$convex",
          replacement: convexRoot,
        },
      ],
    },
    server: {
      port: 3001,
      fs: {
        allow: ["../../.."],
      },
    },
  };
});
