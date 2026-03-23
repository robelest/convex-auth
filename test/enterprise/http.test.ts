import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { expect, test } from "vite-plus/test";

import { convexTest } from "../convex.setup";

function parseJwtPayload(token: string): { sub?: string } {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const json = atob(padded);
  return JSON.parse(json) as { sub?: string };
}

async function enterpriseAdmin(t: any) {
  const result = (await t.action(api.auth.signIn, {
    provider: "anonymous",
  })) as {
    kind: string;
    tokens?: { token: string; refreshToken: string } | null;
  };
  if (result.kind !== "signedIn" || !result.tokens?.token) {
    throw new Error(
      `Expected signedIn with token, got: ${JSON.stringify(result)}`,
    );
  }
  const payload = parseJwtPayload(result.tokens.token);
  if (!payload.sub || !payload.sub.includes("|")) {
    throw new Error(
      `Missing expected subject claim: ${JSON.stringify(payload)}`,
    );
  }
  return t.withIdentity({ subject: payload.sub });
}

test("enterprise control-plane HTTP endpoints are not exposed", async () => {
  const t = convexTest(schema);
  const response = await t.fetch("/api/auth/sso", {
    method: "POST",
    body: JSON.stringify({ name: "Should fail" }),
    headers: { "Content-Type": "application/json" },
  });

  expect([400, 404]).toContain(response.status);
});

test("enterprise management RPC is available when enterprise helpers are mounted", async () => {
  const t = convexTest(schema);
  const asAdmin = await enterpriseAdmin(t);
  const created = await asAdmin.mutation(
    (api as any).auth.enterprise.createConnection,
    {
      name: "Mounted enterprise API",
      slug: "mounted-enterprise-api",
      status: "active",
    },
  );

  expect(created).toEqual(
    expect.objectContaining({
      enterpriseId: expect.any(String),
      groupId: expect.any(String),
    }),
  );

  await asAdmin.mutation((api as any).auth.enterprise.deleteConnection, {
    enterpriseId: created.enterpriseId,
  });

  const metadataResponse = await t.fetch(
    `/api/auth/sso/${created.enterpriseId}/saml/metadata`,
    { method: "GET" },
  );
  expect([400, 404, 500]).toContain(metadataResponse.status);
});
