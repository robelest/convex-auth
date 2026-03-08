import { api } from "@convex/_generated/api";
import { expect, test, vi } from "vitest";

import { convexTest } from "../convex-test";
import schema from "./schema";
import {
  RESEND_API_KEY,
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
} from "./test.helpers";

test("sign in with email", async () => {
  setupEnv();
  const t = convexTest(schema);

  let code;
  let capturedInit: any = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (
        typeof input === "string" &&
        input === "https://api.resend.com/emails"
      ) {
        capturedInit = init;

        // Find the code after ${process.env.SITE_URL}?code=
        code = init.body.match(/\?code=([^\s\\]+)/)?.[1];
        return new Response(JSON.stringify({ id: "email_123" }), {
          status: 200,
        });
      }
      throw new Error("Unexpected fetch");
    }),
  );

  await t.action(api.auth.session.start, {
    provider: "email",
    params: { email: "tom@gmail.com" },
  });
  vi.unstubAllGlobals();

  expect(capturedInit).not.toBeNull();
  expect(capturedInit.headers.Authorization).toBe(
    `Bearer ${process.env.RESEND_API_KEY}`,
  );
  expect(capturedInit.body).toBeTypeOf("string");

  const { tokens } = await t.action(api.auth.session.start, {
    params: { code },
  });

  expect(tokens).not.toBeNull();
});

test("redirectTo with email", async () => {
  setupEnv();
  const t = convexTest(schema);

  let capturedInit: any = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (
        typeof input === "string" &&
        input === "https://api.resend.com/emails"
      ) {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "email_123" }), {
          status: 200,
        });
      }
      throw new Error("Unexpected fetch");
    }),
  );

  await t.action(api.auth.session.start, {
    provider: "email",
    params: { email: "tom@gmail.com", redirectTo: "/dashboard" },
  });
  vi.unstubAllGlobals();

  expect(capturedInit).not.toBeNull();
  expect(capturedInit.headers.Authorization).toBe(
    `Bearer ${process.env.RESEND_API_KEY}`,
  );
  expect(capturedInit.body).toBeTypeOf("string");

  // Custom URL via redirectTo
  const code = capturedInit.body.match(
    /http:\/\/localhost:5173\/dashboard\?code=([^\s\\]+)/,
  )?.[1];
  expect(code).toBeTypeOf("string");
});

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.RESEND_API_KEY = RESEND_API_KEY;
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
