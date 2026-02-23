import { decodeJwt } from "jose";
import { afterEach, expect, test, vi } from "vitest";
import { api, components } from "@convex/_generated/api";
import type { DataModel } from "@convex/_generated/dataModel";
import { client } from "../../auth/src/client/index";
import { convexTest, type TestConvexForDataModel } from "../convex-test";
import schema from "./schema";
import {
  CONVEX_SITE_URL,
  JWKS,
  JWT_PRIVATE_KEY,
  RESEND_API_KEY,
} from "./test.helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("token invite acceptance allows matching unverified email", async () => {
  setupEnv();
  const t = convexTest(schema);
  const inviteEmail = "invited@example.com";

  const { tokens } = await t.action(api.auth.session.start, {
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

  const { tokens } = await t.action(api.auth.session.start, {
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

test("ledger-style proxy sign up can immediately accept invite", async () => {
  setupEnv();
  const t = convexTest(schema);
  const inviteEmail = "ledger-flow@example.com";
  const inviteToken = "ledger-flow-token";
  await createInvite(t, {
    token: inviteToken,
    email: inviteEmail,
  });

  const convex = createConvexTransportMock();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        action?: string;
        args?: Record<string, unknown>;
      };

      if (body.action !== "auth/session:start") {
        return new Response(JSON.stringify({ error: "Unsupported action" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (body.args?.refreshToken === true) {
        return new Response(JSON.stringify({ tokens: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await t.action(api.auth.session.start, body.args ?? {});
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

  const auth = client({
    convex,
    proxy_path: "/api/auth",
    url: "https://example.convex.cloud",
  });

  const signInPromise = auth.sign_in("password", {
    email: inviteEmail,
    password: "44448888",
    flow: "signUp",
  });

  await waitForSetAuthCalls(convex, 2);
  convex.triggerAuthChange(false);
  convex.triggerAuthChange(true);

  const signInResult = await signInPromise;
  expect(signInResult.signingIn).toBe(true);

  const claims = decodeJwt(auth.state.token!);
  expect(typeof claims.sub).toBe("string");
  const acceptResult = await t.withIdentity({ subject: claims.sub as string }).mutation(
    api.invites.acceptToken,
    { token: inviteToken },
  );
  expect(acceptResult.inviteStatus).toBe("accepted");
  expect(acceptResult.membershipStatus).toBe("not_applicable");

  auth.destroy();
});

function createConvexTransportMock() {
  const authRegistrations: Array<{
    fetchToken: (args: { forceRefreshToken: boolean }) => Promise<string | null | undefined>;
    onChange?: (isAuthenticated: boolean) => void;
  }> = [];

  return {
    action: vi.fn(async () => null),
    setAuth: vi.fn((fetchToken, onChange) => {
      authRegistrations.push({ fetchToken, onChange });
    }),
    clearAuth: vi.fn(),
    triggerAuthChange(isAuthenticated: boolean) {
      authRegistrations[authRegistrations.length - 1]?.onChange?.(isAuthenticated);
    },
    setAuthCallCount() {
      return authRegistrations.length;
    },
  };
}

async function waitForSetAuthCalls(
  convex: ReturnType<typeof createConvexTransportMock>,
  count: number,
) {
  const timeoutAt = Date.now() + 1000;
  while (convex.setAuthCallCount() < count) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for setAuth calls (${count})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

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
