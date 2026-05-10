import { wellKnown } from "@robelest/convex-auth/server";

import type { RequestHandler } from "@sveltejs/kit";

export const prerender = false;

export const GET: RequestHandler = () => {
  const result = wellKnown("assetlinks.json");
  if (result === null) {
    return new Response(null, { status: 404 });
  }
  return new Response(result.body, { status: result.status, headers: result.headers });
};
