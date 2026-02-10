import { convexTest } from "../convex-test";
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  signInViaPhone,
} from "./test.helpers";

test("sign in with phone", async () => {
  setupEnv();
  const t = convexTest(schema);
  const tokens = await signInViaPhone(t, "fake-phone", {
    phone: "+1234567890",
  });
  expect(tokens).not.toBeNull();
});

test("repeated signin via phone", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign in via phone
  const initialTokens = await signInViaPhone(t, "fake-phone", {
    phone: "+1234567890",
  });

  // 2. Sign in via the same phone
  const newTokens = await signInViaPhone(t, "fake-phone", {
    phone: "+1234567890",
  });
  expect(initialTokens).not.toBeNull();
  expect(newTokens).not.toBeNull();
  expect(getUserIdFromToken(initialTokens!.token)).toEqual(
    getUserIdFromToken(newTokens!.token),
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
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
