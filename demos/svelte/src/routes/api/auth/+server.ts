import { getAuthServer } from "$lib/server/auth";

import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request }) => {
  return await getAuthServer().proxy(request);
};
