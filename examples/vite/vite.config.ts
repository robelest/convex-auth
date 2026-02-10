import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "../../convex"),
      "@robelest/convex-auth/test": path.resolve(__dirname, "../../packages/auth/src/test.ts"),
      "@robelest/convex-auth": path.resolve(__dirname, "../../packages/auth/dist"),
      "@auth-client": path.resolve(__dirname, "./src/auth-client.tsx"),
    },
  },
});
