import { convexTest } from "../convex-test";
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { components } from "@convex/_generated/api";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  signInViaGitHub,
} from "./test.helpers";

test("sign up with oauth", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { tokens, verifier } = await signInViaGitHub(t, "github", {
    email: "tom@gmail.com",
    name: "Tom",
    id: "someGitHubId",
  });

  expect(tokens).not.toBeNull();

  await t.run(async (ctx) => {
    const storedVerifier = await ctx.runQuery(components.auth.public.verifierGetById, {
      verifierId: verifier,
    });
    expect(storedVerifier).toBeNull();
  });
});

test("sign in with oauth", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { tokens: initialTokens, verifier: initialVerifier } = await signInViaGitHub(
    t,
    "github",
    {
      email: "tom@gmail.com",
      name: "Tom",
      id: "someGitHubId",
    },
  );

  expect(initialTokens).not.toBeNull();
  await t.run(async (ctx) => {
    const storedVerifier = await ctx.runQuery(components.auth.public.verifierGetById, {
      verifierId: initialVerifier,
    });
    expect(storedVerifier).toBeNull();
  });

  const { tokens, verifier } = await signInViaGitHub(t, "github", {
    email: "tom@gmail.com",
    name: "Thomas",
    id: "someGitHubId",
  });

  expect(tokens).not.toBeNull();
  expect(getUserIdFromToken(tokens!.token)).toEqual(
    getUserIdFromToken(initialTokens!.token),
  );

  await t.run(async (ctx) => {
    const storedVerifier = await ctx.runQuery(components.auth.public.verifierGetById, {
      verifierId: verifier,
    });
    expect(storedVerifier).toBeNull();
  });
});

test("redirectTo with oauth", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { url } = await signInViaGitHub(
    t,
    "github",
    {
      email: "tom@gmail.com",
      name: "Tom",
      id: "someGitHubId",
    },
    { redirectTo: "/dashboard" },
  );

  expect(url).toEqual(
    expect.stringContaining("http://localhost:5173/dashboard"),
  );
});

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.AUTH_GITHUB_ID = "githubClientId";
  process.env.AUTH_GITHUB_SECRET = "githubClientSecret";
  process.env.AUTH_LOG_LEVEL = "ERROR";
}

function getUserIdFromToken(token: string) {
  return decodeJwt(token).sub!.split("|")[0];
}
