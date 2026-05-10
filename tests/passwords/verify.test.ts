/**
 * Integration tests for the password provider's `reset` and `verify` flows.
 *
 * `convex/auth.ts` reads `AUTH_PASSWORD_EMAIL_VERIFICATION` at module-init
 * time. The shared test setup defaults the flag to `"false"` so legacy
 * password tests in `tests/passwords.test.ts` keep returning a session
 * directly without intercepting OTP emails. This file flips the flag at the
 * top so `convex/auth.ts` is loaded with `password({ reset, verify })` and
 * the post-signup verification + reset flows are wired through the email
 * provider.
 *
 * Setting `process.env.AUTH_PASSWORD_EMAIL_VERIFICATION = "true"` BEFORE
 * importing the convex modules ensures this file's view of the auth runtime
 * has reset and verify enabled. Vite resolves the convex modules per-file
 * via `import.meta.glob`, so as long as no earlier test in this project has
 * already loaded `convex/auth.ts`, the import-time check picks up the new
 * value.
 */

process.env.AUTH_PASSWORD_EMAIL_VERIFICATION = "true";

import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "../convex/setup";
import { expectSignInSession, stubResendCapture, TEST_PASSWORD } from "../helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("reset flow sends an OTP, lets the user choose a new password, and rotates the secret", async () => {
  const t = convexTest(schema);
  const email = "reset-flow@example.com";

  // Sign up first. With verify enabled, this kicks off email verification —
  // signUp returns `kind: "started"` and an OTP is sent — but the account is
  // created so the reset flow can find it.
  const signUpCapture = stubResendCapture();
  const signUpResult = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email, password: TEST_PASSWORD, flow: "signUp" },
  });
  signUpCapture.restore();
  expect(signUpResult.kind).toBe("started");
  expect(signUpCapture.code()).not.toEqual("");

  // Request a reset code.
  const resetCapture = stubResendCapture();
  const resetStart = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email, flow: "reset" },
  });
  resetCapture.restore();

  expect(resetStart.kind).toBe("started");
  expect(resetCapture.captured()).not.toBeNull();
  expect(resetCapture.code()).not.toEqual("");
  expect(resetCapture.code()).not.toEqual(signUpCapture.code());

  // Complete the reset by calling `verify` with the captured code and a new
  // password. The user should be signed in immediately.
  const NEW_PASSWORD = "freshpassword123";
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email,
        code: resetCapture.code(),
        newPassword: NEW_PASSWORD,
        flow: "verify",
      },
    }),
  );
  expect(tokens).not.toBeNull();

  // The new password works.
  const reSignIn = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: NEW_PASSWORD, flow: "signIn" },
    }),
  );
  expect(reSignIn).not.toBeNull();

  // The old password no longer works.
  await expect(async () => {
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: TEST_PASSWORD, flow: "signIn" },
    });
  }).rejects.toThrow(/Invalid credentials/);
});

test("verify without newPassword completes post-signup email confirmation", async () => {
  const t = convexTest(schema);
  const email = "verify-flow@example.com";

  // Sign up — capture the verification email.
  const capture = stubResendCapture();
  const signUpResult = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email, password: TEST_PASSWORD, flow: "signUp" },
  });
  capture.restore();
  expect(signUpResult.kind).toBe("started");
  expect(capture.code()).not.toEqual("");

  // Complete email verification (no `newPassword` — this is the post-signup
  // path). The user should be signed in.
  const tokens = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email, code: capture.code(), flow: "verify" },
    }),
  );
  expect(tokens).not.toBeNull();

  const claims = decodeJwt(tokens!.token);
  expect(claims.email).toBe(email);
  expect(claims.email_verified).toBe(true);

  // The user can now sign in normally without going through verification.
  const reSignIn = expectSignInSession(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: { email, password: TEST_PASSWORD, flow: "signIn" },
    }),
  );
  expect(reSignIn).not.toBeNull();
});
