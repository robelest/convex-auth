import { api } from "$convex/_generated/api.js";
import { getConvexClient } from "$lib/server/convex";
import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.authToken) {
    return {
      demo: null,
    };
  }

  const client = getConvexClient(locals.authToken);
  const demo = await client.query(api.groups.get, {});

  if (demo.groups.length > 0) {
    const targetGroupId = demo.selectedGroup?.groupId ?? demo.groups[0]?.groupId;
    if (targetGroupId) {
      throw redirect(302, `/${targetGroupId}`);
    }
  }

  return {
    demo,
  };
};
