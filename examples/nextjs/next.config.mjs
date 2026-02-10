import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";

// Load app-local env files first, then fill missing keys from repo root.
loadEnvConfig(__dirname, isDev);
loadEnvConfig(path.join(__dirname, "../.."), isDev, console, true);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
};

export default nextConfig;
