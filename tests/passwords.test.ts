import { api } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex.setup";
import { expectSignInSession, subjectToUserId, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

test("sign up with password", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    }),
  );

  expect(tokens).not.toBeNull();

  const tokens2 = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        flow: "signIn",
      },
    }),
  );

  expect(tokens2).not.toBeNull();
  expect(tokens2!.refreshToken).not.toEqual(tokens!.refreshToken);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email: TEST_EMAIL, password: "wrong", flow: "signIn" },
    });
  }).rejects.toThrow(/Invalid credentials|InvalidSecret/);

  // Sign out from each session and verify refresh behavior follows
  // the session lifetime.

  const claims = decodeJwt(tokens!.token);
  expect(claims.sub).toBeDefined();
  expect(claims.sid).toBeDefined();
  expect(claims.email).toBe(TEST_EMAIL);
  expect(claims.email_verified).toBe(false);

  await t.withIdentity({ subject: claims.sub, sid: claims.sid as any }).action(api.auth.signOut);

  const refreshedFromFirstSession = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedFromFirstSession).toBeNull();

  const refreshedFromSecondSession = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens2!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedFromSecondSession).not.toBeNull();

  const claims2 = decodeJwt(tokens2!.token);
  await t.withIdentity({ subject: claims2.sub, sid: claims2.sid as any }).action(api.auth.signOut);

  const refreshedAfterSecondSignOut = expectSignInSession(
    await t.action(api.auth.signIn, {
      refreshToken: tokens2!.refreshToken,
      params: {},
    }),
  );
  expect(refreshedAfterSecondSignOut).toBeNull();
});

test("sign up with password keeps email unverified by default", async () => {
  const t = convexTest(schema);
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: "unverified@gmail.com",
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    }),
  );

  const claims = decodeJwt(tokens!.token);
  const viewer = await t.run(async (ctx) => {
    return await auth.user.get(ctx as any, subjectToUserId(claims.sub));
  });

  expect(viewer?.email).toBe("unverified@gmail.com");
  expect(viewer?.emailVerificationTime).toBeUndefined();
});

test("password sign up requires email", async () => {
  const t = convexTest(schema);

  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        password: TEST_PASSWORD,
        flow: "signUp",
      },
    });
  }).rejects.toThrow("Missing `email` param");
});
