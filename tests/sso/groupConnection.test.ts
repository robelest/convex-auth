import { api, components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import { group, scim, sso } from "@robelest/convex-auth/server";
import {
  getPublicOidcConfig,
  upsertProtocolConfig,
} from "@robelest/convex-auth/server/sso/config";
import { createGroupConnectionOidcProvider } from "@robelest/convex-auth/server/sso/oidc";
import {
  createServiceProviderMetadata,
  parseSamlIdpMetadata,
} from "@robelest/convex-auth/server/sso/saml";
import { parseScimListRequest } from "@robelest/convex-auth/server/sso/scim";
import {
  getGroupOidcUrls,
  getGroupSamlUrls,
  isGroupSamlSourceActive,
  groupOidcProviderId,
  groupSamlProviderId,
} from "@robelest/convex-auth/server/sso/shared";
import { sha256 } from "@robelest/convex-auth/server/utils";
import idpMetadataXml from "@robelest/samlify/test/misc/idpmeta.xml?raw";
import { SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "../convex.setup";

const GROUP_CONNECTION_SITE_URL = "https://convex-auth.example.com";

const savedEnv: Record<string, string | undefined> = {};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  // Clear tracked keys
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
});

test("group connection component stores group connection records and domains", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Acme Corp",
      slug: "acme",
      type: "organization",
    });
  });

  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionCreate, {
      groupId,
      slug: "acme",
      name: "Acme Corp",
      status: "draft",
        protocol: "saml",
      config: { protocols: { saml: { enabled: true } } },
    });
  });

  const domainId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionDomainAdd, {
      connectionId,
      groupId,
      domain: "acme.com",
      isPrimary: true,
    });
  });

  const connection = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionGet, {
      connectionId,
    });
  });
  const lookup = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionGetByDomain, {
      domain: "acme.com",
    });
  });
  const domains = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionDomainList, {
      connectionId,
    });
  });
  expect(domainId).toBeDefined();
  expect(connection?.groupId).toBe(groupId);
  expect((lookup as any)?.connection?._id ?? (lookup as any)?.group?._id).toBe(
    connectionId,
  );
  expect(domains).toHaveLength(1);
  expect(domains[0]?.isPrimary).toBe(true);
});

test("group connection domain validation reports onboarding diagnostics", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Acme Corp",
      slug: "acme-onboarding",
      type: "organization",
    });
  });

  const created = await t.run(async (ctx) => {
    return await auth.group.sso.connection.create(ctx as any, {
      groupId,
      slug: "acme-onboarding",
      name: "Acme Onboarding",
      status: "active",
      protocol: "oidc",
    });
  });
  const connectionId = created.connectionId;
  expect(connectionId).toBeTruthy();

  await t.run(async (ctx) => {
    await auth.group.sso.connection.domain.set(ctx as any, connectionId, [
      { domain: "acme.example", isPrimary: true },
    ]);
  });

  const missingVerification = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.validate(
      ctx as any,
      connectionId,
    );
  });

  expect(missingVerification.ready).toBe(false);
  expect(missingVerification.summary.domainCount).toBe(1);
  expect(missingVerification.summary.verifiedCount).toBe(0);
  expect(missingVerification.warnings).toContain("No verified domains yet.");

  const request = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.verification.request(
      ctx as any,
      {
        connectionId,
        domain: "acme.example",
      },
    );
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (
        url ===
        "https://dns.google/resolve?name=_convex-auth-verification.acme.example&type=TXT"
      ) {
        return new Response(
          JSON.stringify({
            Answer: [{ data: `"${request.challenge.recordValue}"` }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );

  const confirmation = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.verification.confirm(
      ctx as any,
      {
        connectionId,
        domain: "acme.example",
      },
    );
  });
  expect(confirmation.ok).toBe(true);

  const verified = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.validate(
      ctx as any,
      connectionId,
    );
  });

  expect(verified.ready).toBe(true);
  expect(verified.summary.verifiedCount).toBe(1);
  expect(verified.warnings).toHaveLength(0);
});

test("saml metadata parser extracts core IdP details", () => {
  const parsed = parseSamlIdpMetadata(idpMetadataXml);

  expect(parsed.issuer).toBe("https://idp.example.com/metadata");
  expect(parsed.sso.post).toBe(
    "https://idp.example.org/sso/SingleSignOnService",
  );
  expect(parsed.slo.redirect).toBe(
    "https://idp.example.org/sso/SingleLogoutService",
  );
  expect(parsed.wantsSignedAuthnRequests).toBe(true);
  expect(parsed.nameIdFormats.length).toBeGreaterThan(0);
});

test("service provider metadata generation produces group metadata", () => {
  const metadata = createServiceProviderMetadata({
    entityId: "https://app.example.com/api/auth/connections/acme/saml/metadata",
    acsUrl: "https://app.example.com/api/auth/connections/acme/saml/acs",
    sloUrl: "https://app.example.com/api/auth/connections/acme/saml/slo",
    authnRequestsSigned: false,
  });

  expect(metadata).toContain("EntityDescriptor");
  expect(metadata).toContain(
    "https://app.example.com/api/auth/connections/acme/saml/metadata",
  );
  expect(metadata).toContain(
    "https://app.example.com/api/auth/connections/acme/saml/acs",
  );
});

test("group connection OIDC validates HS256 ID tokens with client secret", async () => {
  const issuer = "https://idp.example.com";
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const clientId = "test-client-id";
  const clientSecret = "test-client-secret";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === discoveryUrl) {
        return new Response(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            id_token_signing_alg_values_supported: ["HS256"],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url === `${issuer}/jwks`) {
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  );

  try {
    const { oauthConfig } = await createGroupConnectionOidcProvider(
      {
        issuer,
        discoveryUrl,
        clientId,
        clientSecret,
      },
      "https://app.example.com/api/auth/connections/example/oidc/callback",
    );

    const nonce = "nonce-123";
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({
      sub: "user-1",
      nonce,
      email: "user@example.com",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode(clientSecret));

    await expect(
      oauthConfig.validateTokens?.(
        {
          idToken,
          accessToken: "access-token",
        },
        { nonce },
      ),
    ).resolves.toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("group connection component stores scim config, audit events, and webhook deliveries", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Globex",
      slug: "globex",
      type: "organization",
    });
  });
  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionCreate, {
      groupId,
      slug: "globex",
      name: "Globex",
      status: "active",
        protocol: "oidc",
    });
  });

  const configured = await t.run(async (ctx) => {
    return await auth.group.sso.scim.configure(ctx, {
      connectionId,
      basePath: "/api/auth/connections/globex/scim/v2",
    });
  });
  const scimConfigId = configured.configId;
  const rawToken = configured.token;

  const identityId = await t.run(async (ctx) => {
    return await ctx.runMutation(
      components.auth.public.groupConnectionScimIdentityUpsert,
      {
        connectionId,
        groupId,
        resourceType: "user",
        externalId: "scim-user-1",
        active: true,
        raw: { userName: "person@globex.com" },
      },
    );
  });
  const auditEventId = await t.run(async (ctx) => {
    return await ctx.runMutation(
      components.auth.public.groupAuditEventCreate,
      {
        connectionId,
        groupId,
        eventType: "group.sso.scim.configured",
        actorType: "system",
        subjectType: "group_connection_scim",
        status: "success",
        occurredAt: Date.now(),
      },
    );
  });
  const { endpointId } = await t.run(async (ctx) => {
    return await auth.group.sso.webhook.endpoint.create(ctx, {
      connectionId,
      url: "https://example.com/webhooks/group-sso",
      secret: "secret-hash",
      subscriptions: ["group.sso.scim.configured"],
    });
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(
      components.auth.public.groupWebhookDeliveryEnqueue,
      {
        connectionId,
        endpointId,
        eventType: "group.sso.scim.configured",
        auditEventId,
        payload: { ok: true },
        nextAttemptAt: Date.now(),
      },
    );
  });

  const scimConfig = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.groupConnectionScimConfigGetByTokenHash,
      {
        tokenHash: await sha256(rawToken),
      },
    );
  });
  const identity = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.groupConnectionScimIdentityGet,
      {
        connectionId,
        resourceType: "user",
        externalId: "scim-user-1",
      },
    );
  });
  const auditEvents = await t.run(async (ctx) => {
    return await auth.group.sso.audit.list(ctx, {
      connectionId,
      limit: 10,
    });
  });
  const readyDeliveries = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.groupWebhookDeliveryListReady,
      {
        now: Date.now(),
        limit: 10,
      },
    );
  });

  expect(scimConfigId).toBeDefined();
  expect(identityId).toBeDefined();
  expect(endpointId).toBeDefined();
  expect(scimConfig?.connectionId).toBe(connectionId);
  expect(identity?.externalId).toBe("scim-user-1");
  expect(
    auditEvents.some(
      (event: { eventType?: string }) =>
        event.eventType === "group.sso.scim.configured",
    ),
  ).toBe(true);
  expect(
    readyDeliveries.some(
      (delivery: { auditEventId?: string }) =>
        delivery.auditEventId === auditEventId,
    ),
  ).toBe(true);
});

test("group connection scim identity lookup is scoped to the group connection", async () => {
  const t = convexTest(schema);

  const userId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.userInsert, {
      data: {
        name: "Shared User",
        email: "shared-scim@example.com",
        emailVerificationTime: Date.now(),
      },
    });
  });

  const first = await t.run(async (ctx) => {
    const groupId = await ctx.runMutation(components.auth.public.groupCreate, {
      name: "First Group Connection",
      slug: "first-group-connection",
    });
    const connectionId = await ctx.runMutation(
      components.auth.public.groupConnectionCreate,
        {
          groupId,
          slug: "first-group-connection",
          name: "First Group Connection",
          status: "active",
          protocol: "oidc",
        },
    );
    await ctx.runMutation(components.auth.public.groupConnectionScimIdentityUpsert, {
      connectionId,
      groupId,
      resourceType: "user",
      externalId: "first-external-id",
      userId,
      active: true,
    });
    return { connectionId, groupId };
  });

  const second = await t.run(async (ctx) => {
    const groupId = await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Second Group Connection",
      slug: "second-group-connection",
    });
    const connectionId = await ctx.runMutation(
      components.auth.public.groupConnectionCreate,
        {
          groupId,
          slug: "second-group-connection",
          name: "Second Group Connection",
          status: "active",
          protocol: "oidc",
        },
    );
    await ctx.runMutation(components.auth.public.groupConnectionScimIdentityUpsert, {
      connectionId,
      groupId,
      resourceType: "user",
      externalId: "second-external-id",
      userId,
      active: true,
    });
    return { connectionId, groupId };
  });

  const firstIdentities = await t.run(async (ctx) => {
    return await ctx.runQuery(
      (components.auth.public as any)
        .groupConnectionScimIdentityListByGroupConnection,
      {
        connectionId: first.connectionId as any,
      },
    );
  });

  const secondIdentities = await t.run(async (ctx) => {
    return await ctx.runQuery(
      (components.auth.public as any)
        .groupConnectionScimIdentityListByGroupConnection,
      {
        connectionId: second.connectionId as any,
      },
    );
  });

  expect(
    firstIdentities.find((identity: any) => identity.userId === userId)?.externalId,
  ).toBe("first-external-id");
  expect(
    secondIdentities.find((identity: any) => identity.userId === userId)?.externalId,
  ).toBe("second-external-id");
});

test("group connection helper utilities build protocol config and provider ids", () => {
  const nextConfig = upsertProtocolConfig({}, "oidc", {
    issuer: "https://issuer.example.com",
    clientId: "client_123",
  });

  expect(nextConfig).toEqual({
    protocols: {
      oidc: {
        issuer: "https://issuer.example.com",
        clientId: "client_123",
      },
    },
  });
  expect(groupOidcProviderId("ent_123")).toBe("group:oidc:ent_123");
  expect(groupSamlProviderId("ent_123")).toBe("group:saml:ent_123");
});

test("group connection route helpers generate clean metadata and callback paths", () => {
  expect(
    getGroupSamlUrls({
      rootUrl: "https://app.example.com",
      source: { kind: "connection", id: "acme" },
    }),
  ).toEqual({
    metadataUrl: "https://app.example.com/api/auth/connections/acme/saml/metadata",
    acsUrl: "https://app.example.com/api/auth/connections/acme/saml/acs",
    sloUrl: "https://app.example.com/api/auth/connections/acme/saml/slo",
  });

  expect(
    getGroupOidcUrls({
      rootUrl: "https://app.example.com",
      connectionId: "acme",
    }),
  ).toEqual({
    signInUrl: "https://app.example.com/api/auth/connections/acme/oidc/signin",
    callbackUrl: "https://app.example.com/api/auth/connections/acme/oidc/callback",
  });
});

test("scim list request parsing normalizes pagination and eq filters", () => {
  const url = new URL(
    "https://app.example.com/api/auth/connections/acme/scim/v2/Users?startIndex=0&count=999&filter=userName%20eq%20%22person@example.com%22",
  );

  expect(parseScimListRequest(url)).toEqual({
    startIndex: 1,
    count: 100,
    filter: {
      attribute: "userName",
      value: "person@example.com",
    },
  });
});

test("group saml source activity is status-gated", () => {
  expect(
    isGroupSamlSourceActive({
      source: { kind: "connection", id: "ent_123" },
      config: {},
      status: "active",
    }),
  ).toBe(true);
  expect(
    isGroupSamlSourceActive({
      source: { kind: "connection", id: "ent_123" },
      config: {},
      status: "draft",
    }),
  ).toBe(false);
});

test("group saml.register persists config directly on group connection", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = GROUP_CONNECTION_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "SAML Register Co",
      slug: "saml-register-co",
      type: "organization",
    });
  });
  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionCreate, {
      groupId,
      slug: "saml-register-co",
      name: "SAML Register Co",
      status: "active",
      protocol: "saml",
    });
  });

  const completed = await t.run(async (ctx) => {
    const metadataXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com/metadata">',
      '  <IDPSSODescriptor WantAuthnRequestsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
      '    <KeyDescriptor use="signing">',
      '      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
      '        <ds:X509Data>',
      '          <ds:X509Certificate>MIIBlzCCATACCQC6n5q7Y9qs0DANBgkqhkiG9w0BAQsFADATMREwDwYDVQQDDAhFeGFtcGxlMB4XDTI2MDEwMTAwMDAwMFoXDTM2MDEwMTAwMDAwMFowEzERMA8GA1UEAwwIRXhhbXBsZTCBnzANBgkqhkiG9w0BAQEFAAOBjQAwgYkCgYEAxT9F4N8wJ6i9wzV4Yw6n8m2s3mK4n4zQ6xV9S7L0Q2f8oUqg6P5lM4wL6V7I3mQf0Q3Lx1Q2U7Jx7wW0Oe0nM4V0a3mX4H2O1qYv8jGQJ2C1sO8Yf5C8W0w7bP1W0Q1x1uJ0r9tYp8F5s8VY4e1s1M3jJ8n1f3P5wYw3s9QmECAwEAATANBgkqhkiG9w0BAQsFAAOBgQB1u4hM1n6rP5M9w1jQk6R5P0rK4g6fJx7F2mK8nQ2wY8tC1n7xP9sV4kL6mR3yQ0hP2uL8Q4yZ7mS2vX5tN1cF8pG4wK9jL2mQ6rF1sT3uV8xY5zA0nQ6jP4mR2sY8wK5fL1nM7qV3tX6yZ0pR8uH2jK4mN6qP1sT9wY7zF0mQ==</ds:X509Certificate>',
      '        </ds:X509Data>',
      '      </ds:KeyInfo>',
      '    </KeyDescriptor>',
      '    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.org/sso/SingleSignOnService" />',
      '    <SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.org/sso/SingleLogoutService" />',
      '    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>',
      '  </IDPSSODescriptor>',
      '</EntityDescriptor>',
    ].join("\n");
    return await auth.group.sso.saml.configure(ctx as any, {
      connectionId,
      metadataXml,
      domains: ["register.example.com"],
      attributeMapping: {
        subject: "UserID",
        email: "Email",
        name: "FullName",
      },
    });
  });

  const connection = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionGet, {
      connectionId,
    });
  });
  const domains = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionDomainList, {
      connectionId,
    });
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupAuditEventList, {
      connectionId,
      limit: 10,
    });
  });
  const policy = await t.run(async (ctx) => {
    return await auth.group.sso.policy.get(ctx as any, groupId);
  });

  expect(completed.connectionId).toBe(connectionId);
  expect(completed.groupId).toBe(groupId);
  expect(connection?.config?.domains).toEqual(["register.example.com"]);
  expect(connection?.config?.protocols?.saml?.idp?.metadataXml).toBeTypeOf(
    "string",
  );
  expect(connection?.config?.protocols?.saml?.attributeMapping).toEqual({
    subject: "UserID",
    email: "Email",
    name: "FullName",
  });
  expect(connection?.config?.protocols?.saml?.accountLinking).toBeUndefined();
  expect(connection?.config?.protocols?.saml?.reuseScimUserBy).toBeUndefined();
  expect(policy.identity.accountLinking.saml).toBe("verifiedEmail");
  expect(policy.provisioning.scimReuse.user).toBe("externalId");
  // These are hardcoded sensible defaults — no longer configurable per-tenant.
  expect(domains[0]?.domain).toBe("register.example.com");
  expect(auditEvents[0]?.eventType).toBe("group.sso.saml.registered");
});

test("mounted group SSO helpers expose only the narrowed public surface", () => {
  const mountedSso = sso(auth);
  const mountedScim = scim(auth);
  const mountedGroup = group(auth, {
    admin: { authorized: async () => {} },
  });

  expect(Object.keys(mountedSso.admin.oidc).sort()).toEqual([
    "configure",
    "get",
    "validate",
  ]);
  expect(Object.keys(mountedSso.admin.saml).sort()).toEqual([
    "configure",
    "validate",
  ]);
  expect(Object.keys(mountedSso.client).sort()).toEqual(["metadata", "signIn"]);
  expect(Object.keys(mountedSso.admin.audit)).toEqual(["list"]);
  expect(Object.keys(mountedSso.admin.webhook).sort()).toEqual([
    "delivery",
    "endpoint",
  ]);
  expect("delivery" in mountedSso.admin.webhook).toBe(true);

  expect(Object.keys(mountedScim.admin).sort()).toEqual([
    "configure",
    "get",
    "validate",
  ]);
  expect("identity" in mountedScim.admin).toBe(false);
  expect("getConfigByToken" in mountedScim.admin).toBe(false);

  expect(Object.keys(mountedGroup).sort()).toEqual([
    "configureOidc",
    "configureSaml",
    "configureScim",
    "confirmDomainVerification",
    "createConnection",
    "createWebhookEndpoint",
    "deleteConnection",
    "disableWebhookEndpoint",
    "getConnection",
    "getConnectionByDomain",
    "getConnectionStatus",
    "getOidc",
    "getPolicy",
    "getScim",
    "listAudit",
    "listConnections",
    "listDomains",
    "listWebhookDeliveries",
    "listWebhookEndpoints",
    "metadata",
    "requestDomainVerification",
    "setDomains",
    "signIn",
    "updateConnection",
    "updatePolicy",
    "validateDomains",
    "validateOidc",
    "validatePolicy",
    "validateSaml",
    "validateScim",
  ]);
});

test("group policy defaults and updates are normalized through auth.group.sso.policy", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Policy Co",
      slug: "policy-co",
      type: "organization",
    });
  });
  const defaults = await t.run(async (ctx) => {
    return await auth.group.sso.policy.get(ctx as any, groupId);
  });
  const updated = await t.run(async (ctx) => {
    return await auth.group.sso.policy.update(ctx as any, groupId, {
      identity: { accountLinking: { saml: "none" } },
      provisioning: {
        jit: { mode: "createUser", defaultRoleIds: ["orgAdmin"] },
        deprovision: { mode: "hard" },
      },
    });
  });
  const validation = await t.run(async (ctx) => {
    return await auth.group.sso.policy.validate(ctx as any, groupId);
  });

  expect(defaults.identity.accountLinking.oidc).toBe("verifiedEmail");
  expect(defaults.provisioning.deprovision.mode).toBe("soft");
  expect(updated.identity.accountLinking.saml).toBe("none");
  expect(updated.provisioning.jit.mode).toBe("createUser");
  expect(updated.provisioning.jit.defaultRoleIds).toEqual(["orgAdmin"]);
  expect(updated.provisioning.deprovision.mode).toBe("hard");
  expect(validation.ok).toBe(true);
});

test("group oidc.register merges config and client.signIn requires verified domains for domain lookup", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = GROUP_CONNECTION_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "OIDC Co",
      slug: "oidc-co",
      type: "organization",
    });
  });
  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionCreate, {
      groupId,
      slug: "oidc-co",
      name: "OIDC Co",
      status: "active",
      protocol: "oidc",
      config: { protocols: { saml: { enabled: true } } },
    });
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.public.groupConnectionDomainAdd, {
      connectionId,
      groupId,
      domain: "oidc.example.com",
      isPrimary: true,
    });
  });

  const oidcConfig = await t.run(async (ctx) => {
    return await auth.group.sso.oidc.configure(ctx as any, {
      connectionId,
      issuer: "https://issuer.example.com",
      discoveryUrl:
        "https://issuer.example.com/.well-known/openid-configuration",
      clientId: "client_123",
      clientSecret: "secret_123",
      scopes: ["openid", "email"],
      authorizationParams: { prompt: "login" },
    });
  });

  const connection = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionGet, {
      connectionId,
    });
  });
  const secret = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupConnectionSecretGet, {
      connectionId,
      kind: "oidc_client_secret",
    } as any);
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupAuditEventList, {
      connectionId,
      limit: 10,
    });
  });
  const explicitResolved = await t.run(async (ctx) => {
    return await auth.group.sso.signIn(ctx as any, {
      connectionId,
      redirectTo: "/dashboard",
    });
  });
  await expect(
    t.run(async (ctx) => {
      return await auth.group.sso.signIn(ctx as any, {
        domain: "oidc.example.com",
        redirectTo: "/dashboard",
      });
    }),
  ).rejects.toThrow(
    "No group connection matched the provided input.",
  );

  const request = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.verification.request(
      ctx as any,
      {
        connectionId,
        domain: "oidc.example.com",
      },
    );
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (
        url ===
        "https://dns.google/resolve?name=_convex-auth-verification.oidc.example.com&type=TXT"
      ) {
        return new Response(
          JSON.stringify({
            Answer: [{ data: `"${request.challenge.recordValue}"` }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );

  const confirmation = await t.run(async (ctx) => {
    return await auth.group.sso.connection.domain.verification.confirm(
      ctx as any,
      {
        connectionId,
        domain: "oidc.example.com",
      },
    );
  });

  const resolved = await t.run(async (ctx) => {
    return await auth.group.sso.signIn(ctx as any, {
      domain: "oidc.example.com",
      redirectTo: "/dashboard",
    });
  });
  const clientResolved = await t.query(api.auth.group.signIn, {
    domain: "oidc.example.com",
    redirectTo: "/dashboard",
  });

  expect(oidcConfig.hasClientSecret).toBe(true);
  expect(connection?.config?.protocols?.saml?.enabled).toBe(true);
  expect(connection?.config?.protocols?.oidc?.issuer).toBe(
    "https://issuer.example.com",
  );
  expect(connection?.config?.protocols?.oidc?.clientSecret).toBeUndefined();
  expect(secret?.ciphertext).toBeDefined();
  expect(auditEvents[0]?.eventType).toBe("group.sso.oidc.registered");
  expect(auditEvents[0]?.metadata?.issuer).toBe("https://issuer.example.com");
  expect(explicitResolved.providerId).toBe("group:oidc:" + connectionId);
  expect(confirmation.ok).toBe(true);
  expect(resolved.providerId).toBe("group:oidc:" + connectionId);
  expect(resolved.signInPath).toBe(
    `${GROUP_CONNECTION_SITE_URL}/api/auth/connections/${connectionId}/oidc/signin`,
  );
  expect(resolved.callbackPath).toBe(
    `${GROUP_CONNECTION_SITE_URL}/api/auth/connections/${connectionId}/oidc/callback`,
  );
  expect(resolved.redirectTo).toBe("/dashboard");
  expect(clientResolved).toEqual(resolved);
  expect(
    (oidcConfig as { clientSecret?: string }).clientSecret,
  ).toBeUndefined();
});

test("public group connection OIDC config omits client secret", () => {
  const config = getPublicOidcConfig({
    protocols: {
      oidc: {
        enabled: true,
        issuer: "https://issuer.example.com",
        clientId: "client_123",
        clientSecret: "secret_123",
      },
    },
  });

  expect(config.clientId).toBe("client_123");
  expect(config.clientSecret).toBeUndefined();
});

test("group connection scim.configure stores hashed token and enqueues subscribed deliveries", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = GROUP_CONNECTION_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "SCIM Corp",
      slug: "scim-corp",
      type: "organization",
    });
  });
  const connectionId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupConnectionCreate, {
      groupId,
      slug: "scim-corp",
      name: "SCIM Corp",
      status: "active",
      protocol: "oidc",
    });
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(
      components.auth.public.groupWebhookEndpointCreate,
      {
        connectionId,
        groupId,
        url: "https://hooks.example.com/a",
        status: "active",
        secretHash: "hash-a",
        subscriptions: ["group.sso.scim.configured"],
      } as any,
    );
    await ctx.runMutation(
      components.auth.public.groupWebhookEndpointCreate,
      {
        connectionId,
        groupId,
        url: "https://hooks.example.com/b",
        status: "disabled",
        secretHash: "hash-b",
        subscriptions: ["group.sso.scim.configured"],
      } as any,
    );
    await ctx.runMutation(
      components.auth.public.groupWebhookEndpointCreate,
      {
        connectionId,
        groupId,
        url: "https://hooks.example.com/c",
        status: "active",
        secretHash: "hash-c",
        subscriptions: ["group.sso.other"],
      } as any,
    );
  });

  const configured = await t.run(async (ctx) => {
    return await auth.group.sso.scim.configure(ctx as any, {
      connectionId,
    });
  });

  const scimConfig = await t.run(async (ctx) => {
    return await auth.group.sso.scim.get(ctx as any, connectionId);
  });
  const lookedUpByToken = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.groupConnectionScimConfigGetByTokenHash,
      {
        tokenHash: await sha256(configured.token),
      },
    );
  });
  const policy = await t.run(async (ctx) => {
    return await auth.group.sso.policy.get(ctx as any, groupId);
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.groupAuditEventList, {
      connectionId,
      limit: 10,
    });
  });
  const deliveries = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.groupWebhookDeliveryListReady,
      {
        now: Date.now(),
        limit: 10,
      },
    );
  });

  expect(configured.token).toBeTruthy();
  expect(scimConfig?.tokenHash).not.toBe(configured.token);
  expect(scimConfig?.basePath).toBe(
    `${GROUP_CONNECTION_SITE_URL}/api/auth/connections/${connectionId}/scim/v2`,
  );
  expect(policy.provisioning.deprovision.mode).toBe("soft");
  expect(lookedUpByToken?._id).toBe(scimConfig?._id);
  expect(auditEvents[0]?.eventType).toBe("group.sso.scim.configured");
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.connectionId).toBe(connectionId);
});
