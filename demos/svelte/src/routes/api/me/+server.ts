import { proxyApiRequest } from "$lib/server/httpApi";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request }) => {
  return await proxyApiRequest(request, "/api/me");
};
