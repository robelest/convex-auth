import { decodeJwt } from "jose";
import { expect, test } from "vitest";
import { api, components } from "@convex/_generated/api";
import type { DataModel } from "@convex/_generated/dataModel";
import { convexTest, type TestConvexForDataModel } from "../convex-test";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  RESEND_API_KEY,
} from "./test.helpers";

test("token invite acceptance allows matching unverified email", async () => {
  setupEnv();
  const t = convexTest(schema);
  const inviteEmail = "invited@example.com";

  const { tokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      email: inviteEmail,
      password: "44448888",
      flow: "signUp",
    },
  });

  const claims = decodeJwt(tokens!.token);
  const token = "invite-token-unverified";
  const inviteId = await createInvite(t, {
    token,
    email: inviteEmail,
  });

  const result = await t.withIdentity({ subject: claims.sub }).mutation(
    api.invites.acceptToken,
    { token },
  );

  expect(result.inviteId).toBe(inviteId);
  expect(result.inviteStatus).toBe("accepted");
  expect(result.membershipStatus).toBe("not_applicable");

  const invite = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.inviteGet, { inviteId });
  });
  expect(invite?.status).toBe("accepted");
  expect(invite?.acceptedByUserId).toBeDefined();
});

test("token invite acceptance still rejects mismatched email", async () => {
  setupEnv();
  const t = convexTest(schema);

  const { tokens } = await t.action(api.auth.signIn, {
    provider: "password",
    params: {
      email: "different@example.com",
      password: "44448888",
      flow: "signUp",
    },
  });

  const claims = decodeJwt(tokens!.token);
  const token = "invite-token-mismatch";
  await createInvite(t, {
    token,
    email: "invited@example.com",
  });

  await expect(async () => {
    await t.withIdentity({ subject: claims.sub }).mutation(api.invites.acceptToken, {
      token,
    });
  }).rejects.toThrow("Invite email does not match accepting user's email");
});

async function createInvite(
  t: TestConvexForDataModel<DataModel>,
  args: { token: string; email: string },
) {
  const tokenHash = await sha256Hex(args.token);
  return await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.inviteCreate, {
      tokenHash,
      status: "pending",
      email: args.email,
      role: "member",
    });
  });
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function setupEnv() {
  process.env.SITE_URL = "http://localhost:5173";
  process.env.CONVEX_SITE_URL = CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = JWT_PRIVATE_KEY;
  process.env.JWKS = JWKS;
  process.env.RESEND_API_KEY = RESEND_API_KEY;
  process.env.AUTH_LOG_LEVEL = "ERROR";
}
