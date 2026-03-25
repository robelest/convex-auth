import { env } from "$env/dynamic/private";

import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  const token = locals.authToken ?? null;

  return {
    convexUrl: env.VITE_CONVEX_URL,
    siteUrl:
      env.CONVEX_SITE_URL ??
      env.VITE_CONVEX_URL?.replace(".cloud", ".site") ??
      null,
    authProviders: {
      google: Boolean(
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.CONVEX_SITE_URL,
      ),
    },
    auth: {
      token,
      isAuthenticated: locals.isAuthenticated ?? false,
    },
  };
};
