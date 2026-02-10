import { convexTest } from "../convex-test";
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "./schema";
import {
  AUTH_RESEND_KEY,
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  signInViaGitHub,
  signInViaMagicLink,
  signInViaOTP,
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
    "resend",
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

test("automatic linking for signin via email", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign in via verified OAuth
  const { tokens: githubTokens } = await signInViaGitHub(t, "github", {
    email: "sarah@gmail.com",
    name: "Sarah",
    id: "someGitHubId",
  });

  // 2. Sign in via the same email
  const newTokens = await signInViaMagicLink(t, "resend", "sarah@gmail.com");
  expect(newTokens).not.toBeNull();
  expect(githubTokens).not.toBeNull();
  expect(getUserIdFromToken(newTokens!.token)).toEqual(
    getUserIdFromToken(githubTokens!.token),
  );
});

test("automatic linking for signin via verified OAuth", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign up via email
  const magicLinkTokens = await signInViaMagicLink(t, "resend", "sarah@gmail.com");

  // 2. Sign in via verified OAuth
  const { tokens: githubTokens } = await signInViaGitHub(t, "github", {
    email: "sarah@gmail.com",
    name: "Sarah",
    id: "someGitHubId",
  });

  expect(magicLinkTokens).not.toBeNull();
  expect(githubTokens).not.toBeNull();
  expect(getUserIdFromToken(magicLinkTokens!.token)).toEqual(
    getUserIdFromToken(githubTokens!.token),
  );
});

test("automatic linking for password email verification", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign up first via verified OAuth
  const { tokens: githubTokens } = await signInViaGitHub(t, "github", {
    email: "michal@gmail.com",
    name: "Michal",
    id: "someGitHubId",
  });

  // 2. Sign in via password and verify email
  const newTokens = await signInViaOTP(t, "password-code", {
    email: "michal@gmail.com",
    flow: "signUp",
    password: "verycomplex",
  });

  expect(newTokens).not.toBeNull();
  expect(githubTokens).not.toBeNull();
  expect(getUserIdFromToken(newTokens!.token)).toEqual(
    getUserIdFromToken(githubTokens!.token),
  );
});

test("no linking to untrusted accounts", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign up first via verified OAuth
  const { tokens: githubTokens } = await signInViaGitHub(t, "github", {
    email: "sarah@gmail.com",
    name: "Sarah",
    id: "someGitHubId",
  });

  // 2. Sign up without email verification
  const { tokens: passwordTokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "sarah@gmail.com", password: "44448888", flow: "signUp" },
  });

  // 3. Sign up via email
  const magicLinkTokens = await signInViaMagicLink(t, "resend", "sarah@gmail.com");

  expect(githubTokens).not.toBeNull();
  expect(passwordTokens).not.toBeNull();
  expect(magicLinkTokens).not.toBeNull();

  expect(getUserIdFromToken(githubTokens!.token)).toEqual(
    getUserIdFromToken(magicLinkTokens!.token),
  );
  expect(getUserIdFromToken(passwordTokens!.token)).not.toEqual(
    getUserIdFromToken(githubTokens!.token),
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
  process.env.AUTH_RESEND_KEY = AUTH_RESEND_KEY;
  process.env.AUTH_GITHUB_ID = "githubClientId";
  process.env.AUTH_GITHUB_SECRET = "githubClientSecret";
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
