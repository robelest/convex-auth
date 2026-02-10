import { convexTest } from "../convex-test";
import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { api, components } from "@convex/_generated/api";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  signInViaPhone,
} from "./test.helpers";

test("automatic linking for signin via phone", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign in via phone
  const initialTokens = await signInViaPhone(t, "fake-phone", {
    phone: "+1234567890",
  });

  // 2. Sign in via the same phone, different provider
  const newTokens = await signInViaPhone(t, "fake-phone-2", {
    phone: "+1234567890",
  });
  expect(initialTokens).not.toBeNull();
  expect(newTokens).not.toBeNull();
  expect(getUserIdFromToken(initialTokens!.token)).toEqual(
    getUserIdFromToken(newTokens!.token),
  );
});

test("no linking to untrusted accounts", async () => {
  setupEnv();
  const t = convexTest(schema);

  // 1. Sign up without phone verification
  const { tokens: passwordTokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: { email: "sarah@gmail.com", password: "44448888", flow: "signUp" },
  });
  expect(passwordTokens).not.toBeNull();

  // 2. Add a phone number
  const passwordUserId = getUserIdFromToken(passwordTokens!.token);
  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.public.userPatch, {
      userId: passwordUserId,
      data: { phone: "+1234567890" },
    });
  });

  // 2. Sign up via phone
  const phoneTokens = await signInViaPhone(t, "fake-phone", {
    phone: "+1234567890",
  });
  expect(phoneTokens).not.toBeNull();
  expect(getUserIdFromToken(phoneTokens!.token)).not.toEqual(passwordUserId);
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
