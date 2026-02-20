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

test("unverified password accounts are not auto-linked to email sign-in", async () => {
  setupEnv();
  const t = convexTest(schema);

  const { tokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "linkme@gmail.com", password: "44448888", flow: "signUp" },
  });

  const claims = decodeJwt(tokens!.token);
  const asUser = t.withIdentity({ subject: claims.sub });

  const newTokens = await signInViaMagicLink(asUser, "email", "linkme@gmail.com");
  expect(newTokens).not.toBeNull();
  expect(getUserIdFromToken(newTokens!.token)).not.toEqual(
    getUserIdFromToken(tokens!.token),
  );
});

test("automatic linking persists across repeated verified email sign-ins", async () => {
  setupEnv();
  const t = convexTest(schema);

  const firstTokens = await signInViaMagicLink(t, "email", "repeat@gmail.com");
  expect(firstTokens).not.toBeNull();

  const secondTokens = await signInViaMagicLink(t, "email", "repeat@gmail.com");
  expect(secondTokens).not.toBeNull();

  expect(getUserIdFromToken(secondTokens!.token)).toEqual(
    getUserIdFromToken(firstTokens!.token),
  );
});

test("no linking to untrusted accounts", async () => {
  setupEnv();
  const t = convexTest(schema);

  const firstTokens = await signInViaMagicLink(t, "email", "first@gmail.com");
  const secondTokens = await signInViaMagicLink(t, "email", "second@gmail.com");

  expect(firstTokens).not.toBeNull();
  expect(secondTokens).not.toBeNull();
  expect(getUserIdFromToken(secondTokens!.token)).not.toEqual(
    getUserIdFromToken(firstTokens!.token),
  );
});

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
