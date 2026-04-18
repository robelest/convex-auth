import { api } from "@convex/_generated/api";
import schema from "@convex/schema";
import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

import { convexTest } from "../convex.setup";

function parseJwtPayload(token: string): { sub?: string } {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const json = atob(padded);
  return JSON.parse(json) as { sub?: string };
}

async function groupAdmin(t: any) {
  const result = (await t.action(api.auth.signIn, {
    provider: "anonymous",
  })) as {
    kind: string;
    tokens?: { token: string; refreshToken: string } | null;
  };
  if (result.kind !== "signedIn" || !result.tokens?.token) {
    throw new Error(`Expected signedIn with token, got: ${JSON.stringify(result)}`);
  }
  const payload = parseJwtPayload(result.tokens.token);
  if (!payload.sub || !payload.sub.includes("|")) {
    throw new Error(`Missing expected subject claim: ${JSON.stringify(payload)}`);
  }
  return t.withIdentity({ subject: payload.sub });
}

test("group SSO control-plane HTTP endpoints are not exposed", async () => {
  const t = convexTest(schema);
  const response = await t.fetch("/api/auth/sso", {
    method: "POST",
    body: JSON.stringify({ name: "Should fail" }),
    headers: { "Content-Type": "application/json" },
  });

  expect([400, 404]).toContain(response.status);
});

test("group management RPC is available when group SSO helpers are mounted", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.createGroup, {
    name: "Mounted group SSO API group",
  });
  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Mounted group SSO API",
    slug: "mounted-group-api",
    protocol: "saml",
    status: "active",
  });

  expect(created).toEqual(
    expect.objectContaining({
      connectionId: expect.any(String),
      groupId: expect.any(String),
    }),
  );

  await asAdmin.mutation(api.auth.group.deleteConnection, {
    connectionId: created.connectionId,
  });

  const metadataResponse = await t.fetch(
    `/api/auth/connections/${created.connectionId}/saml/metadata`,
    { method: "GET" },
  );
  expect([400, 404, 500]).toContain(metadataResponse.status);
});

test("group metadata query returns service provider setup values", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.createGroup, {
    name: "Mounted SAML metadata group",
  });
  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Mounted saml metadata",
    slug: "mounted-saml-metadata",
    protocol: "saml",
    status: "active",
  });

  const metadata = await asAdmin.query(api.auth.group.metadata, {
    connectionId: created.connectionId,
  });

  expect(metadata).toContain("EntityDescriptor");
  expect(metadata).toContain(`/api/auth/connections/${created.connectionId}/saml/metadata`);
  expect(metadata).toContain(`/api/auth/connections/${created.connectionId}/saml/acs`);
  expect(metadata).toContain(`/api/auth/connections/${created.connectionId}/saml/slo`);
});

test("disableWebhookEndpoint authorizes against the endpoint connection", async () => {
  const t = convexTest(schema);
  const asAdmin = await groupAdmin(t);
  const asOtherUser = await groupAdmin(t);
  const { groupId } = await asAdmin.mutation(api.groups.createGroup, {
    name: "Webhook auth group",
  });

  const created = await asAdmin.mutation(api.auth.group.createConnection, {
    groupId,
    name: "Webhook auth",
    slug: "webhook-auth",
    protocol: "oidc",
    status: "active",
  });

  const endpoint = await asAdmin.mutation(api.auth.group.createWebhookEndpoint, {
    connectionId: created.connectionId,
    url: "https://example.com/webhook",
    secret: "super-secret",
    subscriptions: ["user.created"],
  });

  await expect(
    asOtherUser.mutation(api.auth.group.disableWebhookEndpoint, {
      endpointId: endpoint._id,
    }),
  ).rejects.toThrow(ConvexError);

  const disabled = await asAdmin.mutation(api.auth.group.disableWebhookEndpoint, {
    endpointId: endpoint._id,
  });

  expect(disabled).toEqual({ endpointId: endpoint._id });
});
