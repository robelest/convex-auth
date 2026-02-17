import { convexTest } from "../convex-test";
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  RESEND_API_KEY,
  signInViaMagicLink,
} from "./test.helpers";

test("sign in with email signs out existing user with different email", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign up without email verification
  const { tokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "sarah@gmail.com", password: "44448888", flow: "signUp" },
  });

  const claims = decodeJwt(tokens!.token);
  const asMichal = t.withIdentity({ subject: claims.sub });

  const newTokens = await signInViaMagicLink(
    asMichal,
    "email",
    "michal@gmail.com",
  );

  expect(newTokens).not.toBeNull();

  expect(getUserIdFromToken(newTokens!.token)).not.toEqual(
    getUserIdFromToken(tokens!.token),
  );

  const { tokens: refreshedOldSession } = await t.action(api.auth.signIn, {
    refreshToken: tokens!.refreshToken,
    params: {},
  });
  expect(refreshedOldSession).toBeNull();
});

// TODO: Re-add OAuth account linking tests once we implement a proper
// Google OIDC mock (discovery + token exchange + id_token).
test.todo("automatic linking for signin via email");
test.todo("automatic linking for signin via verified OAuth");
test.todo("no linking to untrusted accounts");

function getUserIdFromToken(token: string) {
  return decodeJwt(token).sub!.split("|")[0];
}

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.RESEND_API_KEY = RESEND_API_KEY;
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
