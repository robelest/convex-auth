import { env } from "$env/dynamic/private";
import { ConvexHttpClient } from "convex/browser";

export function getConvexClient(token: string | null) {
  const convexUrl = env.VITE_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("Missing VITE_CONVEX_URL for the Svelte demo app.");
  }
  const client = new ConvexHttpClient(convexUrl);
  if (token) {
    client.setAuth(token);
  }
  return client;
}
