import { wellKnown } from "@robelest/convex-auth/server";

import type { RequestHandler } from "@sveltejs/kit";

export const prerender = false;

// Default landing for password manager `/.well-known/change-password` deep
// links. Override via the `CHANGE_PASSWORD_URL` env var to point at a
// different host or path.
const DEFAULT_CHANGE_PASSWORD_PATH = "/settings/password";

export const GET: RequestHandler = ({ url }) => {
  const target =
    process.env.CHANGE_PASSWORD_URL && process.env.CHANGE_PASSWORD_URL.length > 0
      ? process.env.CHANGE_PASSWORD_URL
      : new URL(DEFAULT_CHANGE_PASSWORD_PATH, url.origin).toString();
  const result = wellKnown("change-password", { changePassword: { targetUrl: target } });
  if (result === null) {
    return new Response(null, { status: 404 });
  }
  return new Response(result.body, { status: result.status, headers: result.headers });
};
