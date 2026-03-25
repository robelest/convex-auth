import { api } from "$convex/_generated/api.js";
import { getConvexClient } from "$lib/server/convex";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.authToken) {
    return {
      demo: null,
    };
  }

  const client = getConvexClient(locals.authToken);
  const workspaceId = url.searchParams.get("workspace") ?? undefined;
  const demo = await client.query(
    api.demo.dashboard,
    workspaceId ? { workspaceId } : {},
  );

  return {
    demo,
  };
};
