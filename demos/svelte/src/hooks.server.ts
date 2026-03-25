import { applyAuthCookies, getAuthServer } from "$lib/server/auth";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  const authServer = getAuthServer();
  const refreshed = await authServer.refresh(event.request);

  if (refreshed.redirect) return refreshed.response;

  applyAuthCookies(event.cookies, refreshed);
  event.locals.authToken = refreshed.token;
  event.locals.isAuthenticated = refreshed.token !== null;

  return resolve(event);
};
