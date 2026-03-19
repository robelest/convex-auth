import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "./convex.setup";

test("sign up with oauth starts redirect flow", async () => {
  const t = convexTest(schema);

  const result = await t.action(api.auth.session.start, {
    provider: "google",
  });

  expect(result.kind).toBe("redirect");
  if (result.kind !== "redirect") {
    throw new Error(`Expected redirect, got: ${JSON.stringify(result)}`);
  }

  const redirect = new URL(result.redirect);
  expect(redirect.origin).toBe(process.env.CONVEX_SITE_URL);
  expect(redirect.pathname).toBe("/api/auth/signin/google");
  expect(redirect.searchParams.get("code")).toBe(result.verifier);
});

test("sign in with oauth issues a fresh verifier", async () => {
  const t = convexTest(schema);

  const first = await t.action(api.auth.session.start, { provider: "google" });
  const second = await t.action(api.auth.session.start, { provider: "google" });

  expect(first.kind).toBe("redirect");
  expect(second.kind).toBe("redirect");
  if (first.kind !== "redirect" || second.kind !== "redirect") {
    throw new Error("Expected redirect sign-in results.");
  }

  expect(first.verifier).toBeDefined();
  expect(second.verifier).toBeDefined();
  expect(second.verifier).not.toEqual(first.verifier);
});

test("redirectTo with oauth preserves auth redirect semantics", async () => {
  const t = convexTest(schema);

  const result = await t.action(api.auth.session.start, {
    provider: "google",
    params: {
      redirectTo: "/dashboard",
    },
  });

  expect(result.kind).toBe("redirect");
  if (result.kind !== "redirect") {
    throw new Error(`Expected redirect, got: ${JSON.stringify(result)}`);
  }

  const redirect = new URL(result.redirect);
  expect(redirect.origin).toBe(process.env.CONVEX_SITE_URL);
  expect(redirect.pathname).toBe("/api/auth/signin/google");
  expect(redirect.searchParams.get("code")).toBe(result.verifier);
});
