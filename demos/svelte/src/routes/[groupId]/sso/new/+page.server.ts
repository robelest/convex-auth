import { requireSsoManagerAccess } from "$lib/server/sso";

import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  await requireSsoManagerAccess({
    authToken: locals.authToken,
    groupId: params.groupId,
  });

  return { groupId: params.groupId };
};
