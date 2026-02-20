import { convexTest } from "../convex-test";
import { expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  RESEND_API_KEY,
} from "./test.helpers";

test("sign up with oauth starts redirect flow", async () => {
  setupEnv();
  const t = convexTest(schema);

  const result = await t.action(api.auth.signIn, {
    provider: "google",
  });

  expect(result.redirect).toBeDefined();
  expect(result.verifier).toBeDefined();
  expect(result.tokens).toBeUndefined();

  const redirect = new URL(result.redirect!);
  expect(redirect.origin).toBe(CONVEX_SITE_URL);
  expect(redirect.pathname).toBe("/api/auth/signin/google");
  expect(redirect.searchParams.get("code")).toBe(result.verifier);
});

test("sign in with oauth issues a fresh verifier", async () => {
  setupEnv();
  const t = convexTest(schema);

  const first = await t.action(api.auth.signIn, { provider: "google" });
  const second = await t.action(api.auth.signIn, { provider: "google" });

  expect(first.verifier).toBeDefined();
  expect(second.verifier).toBeDefined();
  expect(second.verifier).not.toEqual(first.verifier);
});

test("redirectTo with oauth preserves auth redirect semantics", async () => {
  setupEnv();
  const t = convexTest(schema);

  const result = await t.action(api.auth.signIn, {
    provider: "google",
    params: {
      redirectTo: "/dashboard",
    },
  });

  expect(result.redirect).toBeDefined();
  expect(result.verifier).toBeDefined();
  expect(result.tokens).toBeUndefined();

  const redirect = new URL(result.redirect!);
  expect(redirect.origin).toBe(CONVEX_SITE_URL);
  expect(redirect.pathname).toBe("/api/auth/signin/google");
  expect(redirect.searchParams.get("code")).toBe(result.verifier);
});

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.RESEND_API_KEY = RESEND_API_KEY;
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
