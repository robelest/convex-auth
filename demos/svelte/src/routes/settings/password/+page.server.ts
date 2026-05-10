import { api } from "$convex/_generated/api.js";
import { getConvexClient } from "$lib/server/convex";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authToken) {
    return { user: null };
  }

  const client = getConvexClient(locals.authToken);
  const demo = await client.query(api.groups.get, {});
  return {
    user: demo.user
      ? { name: demo.user.name, email: demo.user.email }
      : null,
  };
};
