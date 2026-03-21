import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "./convex.setup";
import { expectSignedInResult, TEST_EMAIL, TEST_PASSWORD } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

test("rate limit on password", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema);

  await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: TEST_EMAIL, password: TEST_PASSWORD, flow: "signUp" },
  });

  const SECOND_MS = 1000;
  const MINUTE_MS = SECOND_MS * 60;

  // First we're gonna fail 10 times quickly
  for (let i = 0; i < 10; i++) {
    vi.advanceTimersByTime(10 * SECOND_MS);
    await expect(
      async () =>
        await t.action(api.auth.signIn, {
          provider: "password",
          params: {
            email: TEST_EMAIL,
            password: "nobueno",
            flow: "signIn",
          },
        }),
    ).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
  }

  // Now we can't succeed, even with the right password
  await expect(
    async () =>
      await t.action(api.auth.signIn, {
        provider: "password",
        params: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          flow: "signIn",
        },
      }),
  ).rejects.toThrow(/ACCOUNT_NOT_FOUND/);

  // But if we wait a little bit, we can try again
  vi.advanceTimersByTime(8 * MINUTE_MS);

  const tokens = expectSignedInResult(
    await t.action(api.auth.signIn, {
      provider: "password",
      params: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        flow: "signIn",
      },
    }),
  );
  expect(tokens).not.toBeNull();
});
