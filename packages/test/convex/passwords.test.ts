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
  mockResendOTP,
} from "./test.helpers";

test("sign up with password", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { tokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "sarah@gmail.com", password: "44448888", flow: "signUp" },
  });

  expect(tokens).not.toBeNull();

  const { tokens: tokens2 } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "sarah@gmail.com", password: "44448888", flow: "signIn" },
  });

  expect(tokens2).not.toBeNull();
  expect(tokens2!.refreshToken).not.toEqual(tokens!.refreshToken);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: "sarah@gmail.com", password: "wrong", flow: "signIn" },
    });
  }).rejects.toThrow("InvalidSecret");

  // Sign out from each session and verify refresh behavior follows
  // the session lifetime.

  const claims = decodeJwt(tokens!.token);
  await t.withIdentity({ subject: claims.sub }).action(api.auth.signOut);

  const { tokens: refreshedFromFirstSession } = await t.action(api.auth.signIn, {
    refreshToken: tokens!.refreshToken,
    params: {},
  });
  expect(refreshedFromFirstSession).toBeNull();

  const { tokens: refreshedFromSecondSession } = await t.action(api.auth.signIn, {
    refreshToken: tokens2!.refreshToken,
    params: {},
  });
  expect(refreshedFromSecondSession).not.toBeNull();

  const claims2 = decodeJwt(tokens2!.token);
  await t.withIdentity({ subject: claims2.sub }).action(api.auth.signOut);

  const { tokens: refreshedAfterSecondSignOut } = await t.action(api.auth.signIn, {
    refreshToken: tokens2!.refreshToken,
    params: {},
  });
  expect(refreshedAfterSecondSignOut).toBeNull();
});

test("sign up with password and verify email", async () => {
  setupEnv();
  const t = convexTest(schema);

  const {
    code,
    result: { tokens },
  } = await mockResendOTP(
    async () =>
      await t.action(api.auth.signIn, {
        provider: "password-code",
        params: {
          email: "sarah@gmail.com",
          password: "44448888",
          flow: "signUp",
        },
      }),
  );

  // Not signed in because we sent an email
  expect(tokens).toBeNull();

  // Finish email verification with code
  const { tokens: validTokens } = await t.action(api.auth.signIn, {
    provider: "password-code",
    params: {
      email: "sarah@gmail.com",
      flow: "email-verification",
      code,
    },
  });

  expect(validTokens).not.toBeNull();

  // Now we can sign-in just with a password
  const { tokens: validTokens2 } = await t.action(api.auth.signIn, {
    provider: "password-code",
    params: {
      email: "sarah@gmail.com",
      flow: "signIn",
      password: "44448888",
    },
  });

  expect(validTokens2).not.toBeNull();
});

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.AUTH_RESEND_KEY = AUTH_RESEND_KEY;
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
