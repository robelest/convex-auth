/**
 * Convex client setup for the CLI app.
 *
 * Uses ConvexHttpClient for auth actions (device flow) and
 * ConvexClient for real-time subscriptions (messages, groups).
 *
 * Reads .env.local from the monorepo root (walks up from this file)
 * since Bun auto-loads .env.local relative to cwd which may differ.
 */

import { ConvexHttpClient, ConvexClient } from "convex/browser";
import { resolve, dirname } from "node:path";

function findEnvFile(): string | null {
  let dir = dirname(Bun.main);
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, ".env.local");
    if (Bun.file(candidate).size > 0) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Load .env.local from repo root if not already in env
if (!Bun.env.VITE_CONVEX_URL && !Bun.env.CONVEX_URL) {
  const envPath = findEnvFile();
  if (envPath) {
    const content = await Bun.file(envPath).text();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!Bun.env[key]) {
        Bun.env[key] = val;
      }
    }
  }
}

const CONVEX_URL = Bun.env.VITE_CONVEX_URL ?? Bun.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.error(
    "Missing CONVEX_URL or VITE_CONVEX_URL in environment.\n" +
      "Set it in .env.local at the monorepo root, or pass it as an environment variable.",
  );
  process.exit(1);
}

/** HTTP client for one-shot actions (auth, mutations). */
export const httpClient = new ConvexHttpClient(CONVEX_URL);

/** Real-time client for subscriptions (messages, groups). */
export const realtimeClient = new ConvexClient(CONVEX_URL);

/**
 * Set the auth token on both clients.
 *
 * ConvexHttpClient.setAuth takes a raw token string.
 * ConvexClient.setAuth takes a fetchToken callback that returns the token.
 */
export function setAuth(token: string) {
  httpClient.setAuth(token);
  realtimeClient.setAuth(() => Promise.resolve(token));
}

/**
 * Clear auth from both clients.
 */
export function clearAuth() {
  httpClient.clearAuth();
  realtimeClient.clearAuth();
}

export { CONVEX_URL };
