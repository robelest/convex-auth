import { redirect } from "@sveltejs/kit";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const workspaceId = url.searchParams.get("workspace");
  if (!workspaceId) {
    redirect(302, "/");
  }
  return { workspaceId };
};
