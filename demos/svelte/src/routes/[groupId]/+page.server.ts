import { redirect } from "@sveltejs/kit";
import type { GroupSummary } from "../../../../../convex/shared";

import { api } from "$convex/_generated/api.js";
import { getConvexClient } from "$lib/server/convex";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.authToken) {
    return {
      groupId: params.groupId,
      demo: null,
    };
  }

  const client = getConvexClient(locals.authToken);
  const demo = await client.query(api.groups.getDashboard, {
    groupId: params.groupId,
  });
  const groups = demo.groups as GroupSummary[];

  if (!demo.selectedGroup) {
    const fallbackGroupId = groups.length > 0 ? groups[0]!.groupId : null;
    if (fallbackGroupId) {
      throw redirect(302, `/${fallbackGroupId}`);
    }
    throw redirect(302, "/");
  }

  if (demo.selectedGroup.groupId !== params.groupId) {
    throw redirect(302, `/${demo.selectedGroup.groupId}`);
  }

  return {
    groupId: params.groupId,
    demo,
  };
};
