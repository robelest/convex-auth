import { convexTest } from "../convex-test";
import { expect, test } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  RESEND_API_KEY,
  signInViaMagicLink,
} from "./test.helpers";
import { decodeJwt } from "jose";

test("sign in anonymously", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { tokens } = await t.action(api.auth.signIn, { provider: "anonymous" });
  expect(tokens).not.toBeNull();
});

test.todo("convert anonymous user to permanent", async () => {
  setupEnv();
  const t = convexTest(schema);
  const { tokens } = await t.action(api.auth.signIn, { provider: "anonymous" });
  const claims = decodeJwt(tokens!.token);
  const asAnonymous = t.withIdentity({ subject: claims.sub });
  const newTokens = await signInViaMagicLink(
    asAnonymous,
    "email",
    "mike@gmail.com",
  );
  expect(newTokens).not.toBeNull();

  const newClaims = decodeJwt(newTokens!.token);
  expect(newClaims.sub).toEqual(claims.sub);

  const viewer = await t.withIdentity({ subject: newClaims.sub }).query(
    api.users.viewer,
    {},
  );
  expect(viewer).toMatchObject({ email: "mike@gmail.com" });
  expect(viewer).not.toHaveProperty("isAnonymous");
});

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.RESEND_API_KEY = RESEND_API_KEY;
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
