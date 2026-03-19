import { api } from "@convex/_generated/api";
import { expect, vi } from "vite-plus/test";

import type { TestConvexForDataModel } from "./convex.setup";

// Shared test constants
export const TEST_EMAIL = "sarah@gmail.com";
export const TEST_PASSWORD = "44448888";
export const RESEND_API_URL = "https://api.resend.com/emails";
export const MOCK_EMAIL_ID = "email_123";

/**
 * Assert that a sign-in result has kind "signedIn" and return the tokens.
 * Returns `null` when the server indicates no active session (tokens absent).
 */
export function expectSignedInResult(result: {
  kind: string;
  tokens?: { token: string; refreshToken: string } | null;
}) {
  expect(result.kind).toBe("signedIn");
  return result.kind === "signedIn" ? (result.tokens ?? null) : null;
}

/**
 * Perform a full magic-link email sign-in flow: send the OTP email via a
 * stubbed `fetch`, extract the code, then exchange it for tokens.
 */
export async function signInViaMagicLink(
  t: TestConvexForDataModel<any>,
  provider: string,
  email: string,
) {
  let code = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init) => {
      if (typeof input === "string" && input === RESEND_API_URL) {
        const body = String(init.body ?? "");
        code = body.match(/\?code=([^\s\\]+)/)?.[1] ?? "";
        expect(code).not.toEqual("");
        return new Response(JSON.stringify({ id: MOCK_EMAIL_ID }), {
          status: 200,
        });
      }
      throw new Error("Unexpected fetch");
    }),
  );

  await t.action(api.auth.session.start, { provider, params: { email } });
  vi.unstubAllGlobals();

  const result = await t.action(api.auth.session.start, {
    params: { code },
  });
  return expectSignedInResult(result);
}
