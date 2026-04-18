import { api } from "$convex/_generated/api.js";
import { env } from "$env/dynamic/private";
import { getConvexClient } from "$lib/server/convex";

import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  const token = locals.authToken ?? null;
  const client = getConvexClient(token);
  const authProviders = await client.query(api.groups.getAuthProviders, {});

  return {
    convexUrl: env.VITE_CONVEX_URL,
    siteUrl: env.CONVEX_SITE_URL ?? env.VITE_CONVEX_URL?.replace(".cloud", ".site") ?? null,
    authProviders,
    auth: {
      token,
      isAuthenticated: locals.isAuthenticated ?? false,
    },
  };
};
