import { components } from "@convex/_generated/api";
import { auth } from "@convex/auth";
import schema from "@convex/schema";
import {
  createEnterpriseOidcProvider,
  getEnterpriseOidcUrls,
  getEnterpriseSamlUrls,
  isEnterpriseSamlSourceActive,
  enterpriseOidcProviderId,
  enterpriseSamlProviderId,
  parseScimListRequest,
  createServiceProviderMetadata,
  parseSamlIdpMetadata,
  upsertProtocolConfig,
} from "@robelest/convex-auth/server/sso";
import idpMetadataXml from "@robelest/samlify/test/misc/idpmeta.xml?raw";
import { SignJWT } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { convexTest } from "../convex.setup";

const ENTERPRISE_SITE_URL = "https://convex-auth.example.com";

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

test("enterprise component stores enterprise records and domains", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Acme Corp",
      slug: "acme",
      type: "organization",
    });
  });

  const enterpriseId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseCreate, {
      groupId,
      slug: "acme",
      name: "Acme Corp",
      status: "draft",
      config: { protocols: { saml: { enabled: true } } },
    });
  });

  const domainId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseDomainAdd, {
      enterpriseId,
      groupId,
      domain: "acme.com",
      isPrimary: true,
    });
  });

  const enterprise = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseGet, {
      enterpriseId,
    });
  });
  const lookup = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseGetByDomain, {
      domain: "acme.com",
    });
  });
  const domains = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseDomainList, {
      enterpriseId,
    });
  });
  expect(domainId).toBeDefined();
  expect(enterprise?.groupId).toBe(groupId);
  expect(lookup?.enterprise._id).toBe(enterpriseId);
  expect(domains).toHaveLength(1);
  expect(domains[0]?.isPrimary).toBe(true);
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

test("service provider metadata generation produces enterprise metadata", () => {
  const metadata = createServiceProviderMetadata({
    entityId: "https://app.example.com/api/auth/sso/acme/saml/metadata",
    acsUrl: "https://app.example.com/api/auth/sso/acme/saml/acs",
    sloUrl: "https://app.example.com/api/auth/sso/acme/saml/slo",
    authnRequestsSigned: false,
  });

  expect(metadata).toContain("EntityDescriptor");
  expect(metadata).toContain(
    "https://app.example.com/api/auth/sso/acme/saml/metadata",
  );
  expect(metadata).toContain(
    "https://app.example.com/api/auth/sso/acme/saml/acs",
  );
});

test("enterprise OIDC validates HS256 ID tokens with client secret", async () => {
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
    const { oauthConfig } = await createEnterpriseOidcProvider(
      {
        issuer,
        discoveryUrl,
        clientId,
        clientSecret,
      },
      "https://app.example.com/api/auth/sso/example/oidc/callback",
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
          idToken: () => idToken,
          accessToken: () => "access-token",
        },
        { nonce },
      ),
    ).resolves.toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("enterprise component stores scim config, audit events, and webhook deliveries", async () => {
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "Globex",
      slug: "globex",
      type: "organization",
    });
  });
  const enterpriseId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseCreate, {
      groupId,
      slug: "globex",
      name: "Globex",
      status: "active",
    });
  });

  const configured = await t.run(async (ctx) => {
    return await auth.sso.scim.configure(ctx, {
      enterpriseId,
      basePath: "/api/auth/sso/globex/scim/v2",
      deprovisionMode: "soft",
    });
  });
  const scimConfigId = configured.configId;
  const rawToken = configured.token;

  const identityId = await t.run(async (ctx) => {
    return await auth.sso.scim.identity.upsert(ctx, {
      enterpriseId,
      groupId,
      resourceType: "user",
      externalId: "scim-user-1",
      active: true,
      raw: { userName: "person@globex.com" },
    });
  });
  const auditEventId = await t.run(async (ctx) => {
    return await auth.sso.audit.record(ctx, {
      enterpriseId,
      groupId,
      eventType: "enterprise.scim.configured",
      actorType: "system",
      subjectType: "enterprise_scim",
      ok: true,
    });
  });
  const { endpointId } = await t.run(async (ctx) => {
    return await auth.sso.webhook.endpoint.create(ctx, {
      enterpriseId,
      url: "https://example.com/webhooks/enterprise",
      secret: "secret-hash",
      subscriptions: ["enterprise.scim.configured"],
    });
  });
  await t.run(async (ctx) => {
    await auth.sso.webhook.emit(ctx, {
      enterpriseId,
      eventType: "enterprise.scim.configured",
      auditEventId,
      payload: { ok: true },
    });
  });

  const scimConfig = await t.run(async (ctx) => {
    return await auth.sso.scim.getConfigByToken(ctx, rawToken);
  });
  const identity = await t.run(async (ctx) => {
    return await auth.sso.scim.identity.get(ctx, {
      enterpriseId,
      resourceType: "user",
      externalId: "scim-user-1",
    });
  });
  const auditEvents = await t.run(async (ctx) => {
    return await auth.sso.audit.list(ctx, {
      enterpriseId,
      limit: 10,
    });
  });
  const readyDeliveries = await t.run(async (ctx) => {
    return await auth.sso.webhook.delivery.listReady(ctx, 10);
  });

  expect(scimConfigId).toBeDefined();
  expect(identityId).toBeDefined();
  expect(endpointId).toBeDefined();
  expect(scimConfig?.enterpriseId).toBe(enterpriseId);
  expect(identity?.externalId).toBe("scim-user-1");
  expect(
    auditEvents.some(
      (event: { eventType?: string }) =>
        event.eventType === "enterprise.scim.configured",
    ),
  ).toBe(true);
  expect(
    readyDeliveries.some(
      (delivery: { auditEventId?: string }) =>
        delivery.auditEventId === auditEventId,
    ),
  ).toBe(true);
});

test("enterprise helper utilities build protocol config and provider ids", () => {
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
  expect(enterpriseOidcProviderId("ent_123")).toBe("enterprise:oidc:ent_123");
  expect(enterpriseSamlProviderId("ent_123")).toBe("enterprise:saml:ent_123");
});

test("enterprise route helpers generate clean metadata and callback paths", () => {
  expect(
    getEnterpriseSamlUrls({
      rootUrl: "https://app.example.com",
      source: { kind: "enterprise", id: "acme" },
    }),
  ).toEqual({
    metadataUrl: "https://app.example.com/api/auth/sso/acme/saml/metadata",
    acsUrl: "https://app.example.com/api/auth/sso/acme/saml/acs",
    sloUrl: "https://app.example.com/api/auth/sso/acme/saml/slo",
  });

  expect(
    getEnterpriseOidcUrls({
      rootUrl: "https://app.example.com",
      enterpriseId: "acme",
    }),
  ).toEqual({
    signInUrl: "https://app.example.com/api/auth/sso/acme/oidc/signin",
    callbackUrl: "https://app.example.com/api/auth/sso/acme/oidc/callback",
  });
});

test("scim list request parsing normalizes pagination and eq filters", () => {
  const url = new URL(
    "https://app.example.com/api/auth/sso/acme/scim/v2/Users?startIndex=0&count=999&filter=userName%20eq%20%22person@example.com%22",
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

test("enterprise saml source activity is status-gated", () => {
  expect(
    isEnterpriseSamlSourceActive({
      source: { kind: "enterprise", id: "ent_123" },
      config: {},
      status: "active",
    }),
  ).toBe(true);
  expect(
    isEnterpriseSamlSourceActive({
      source: { kind: "enterprise", id: "ent_123" },
      config: {},
      status: "draft",
    }),
  ).toBe(false);
});

test("enterprise saml.register persists config directly on enterprise connection", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = ENTERPRISE_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "SAML Register Co",
      slug: "saml-register-co",
      type: "organization",
    });
  });
  const enterpriseId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseCreate, {
      groupId,
      slug: "saml-register-co",
      name: "SAML Register Co",
      status: "active",
    });
  });

  const completed = await t.run(async (ctx) => {
    return await auth.sso.saml.configure(ctx as any, {
      enterpriseId,
      metadataXml: idpMetadataXml,
      domains: ["register.example.com"],
      attributeMapping: {
        subject: "UserID",
        email: "Email",
        name: "FullName",
      },
    });
  });

  const enterprise = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseGet, {
      enterpriseId,
    });
  });
  const domains = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseDomainList, {
      enterpriseId,
    });
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseAuditEventList, {
      enterpriseId,
      limit: 10,
    });
  });

  expect(completed.enterpriseId).toBe(enterpriseId);
  expect(completed.groupId).toBe(groupId);
  expect(enterprise?.config?.domains).toEqual(["register.example.com"]);
  expect(enterprise?.config?.protocols?.saml?.idp?.metadataXml).toBeTypeOf(
    "string",
  );
  expect(enterprise?.config?.protocols?.saml?.attributeMapping).toEqual({
    subject: "UserID",
    email: "Email",
    name: "FullName",
  });
  expect(enterprise?.config?.protocols?.saml?.accountLinking).toBe(
    "verifiedEmail",
  );
  expect(enterprise?.config?.protocols?.saml?.reuseScimUserBy).toBe(
    "externalId",
  );
  // These are hardcoded sensible defaults — no longer configurable per-tenant.
  expect(domains[0]?.domain).toBe("register.example.com");
  expect(auditEvents[0]?.eventType).toBe("enterprise.saml.registered");
});

test("enterprise oidc.register merges config and resolveSignIn returns enterprise paths", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = ENTERPRISE_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "OIDC Co",
      slug: "oidc-co",
      type: "organization",
    });
  });
  const enterpriseId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseCreate, {
      groupId,
      slug: "oidc-co",
      name: "OIDC Co",
      status: "active",
      config: { protocols: { saml: { enabled: true } } },
    });
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(components.auth.public.enterpriseDomainAdd, {
      enterpriseId,
      groupId,
      domain: "oidc.example.com",
      isPrimary: true,
    });
  });

  const oidcConfig = await t.run(async (ctx) => {
    return await auth.sso.oidc.configure(ctx as any, {
      enterpriseId,
      issuer: "https://issuer.example.com",
      discoveryUrl:
        "https://issuer.example.com/.well-known/openid-configuration",
      clientId: "client_123",
      clientSecret: "secret_123",
      scopes: ["openid", "email"],
      authorizationParams: { prompt: "login" },
    });
  });

  const enterprise = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseGet, {
      enterpriseId,
    });
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseAuditEventList, {
      enterpriseId,
      limit: 10,
    });
  });
  const resolved = await t.run(async (ctx) => {
    return await auth.sso.oidc.resolveSignIn(ctx as any, {
      domain: "oidc.example.com",
      redirectTo: "/dashboard",
    });
  });

  expect(oidcConfig.enabled).toBe(true);
  expect(enterprise?.config?.protocols?.saml?.enabled).toBe(true);
  expect(enterprise?.config?.protocols?.oidc?.issuer).toBe(
    "https://issuer.example.com",
  );
  expect(auditEvents[0]?.eventType).toBe("enterprise.oidc.registered");
  expect(auditEvents[0]?.metadata?.issuer).toBe("https://issuer.example.com");
  expect(resolved.providerId).toBe("enterprise:oidc:" + enterpriseId);
  expect(resolved.signInPath).toBe(
    `${ENTERPRISE_SITE_URL}/api/auth/sso/${enterpriseId}/oidc/signin`,
  );
  expect(resolved.callbackPath).toBe(
    `${ENTERPRISE_SITE_URL}/api/auth/sso/${enterpriseId}/oidc/callback`,
  );
  expect(resolved.redirectTo).toBe("/dashboard");
});

test("enterprise scim.configure stores hashed token and enqueues subscribed deliveries", async () => {
  savedEnv.CONVEX_SITE_URL = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = ENTERPRISE_SITE_URL;
  const t = convexTest(schema);

  const groupId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.groupCreate, {
      name: "SCIM Corp",
      slug: "scim-corp",
      type: "organization",
    });
  });
  const enterpriseId = await t.run(async (ctx) => {
    return await ctx.runMutation(components.auth.public.enterpriseCreate, {
      groupId,
      slug: "scim-corp",
      name: "SCIM Corp",
      status: "active",
    });
  });
  await t.run(async (ctx) => {
    await ctx.runMutation(
      components.auth.public.enterpriseWebhookEndpointCreate,
      {
        enterpriseId,
        groupId,
        url: "https://hooks.example.com/a",
        status: "active",
        secretHash: "hash-a",
        subscriptions: ["enterprise.scim.configured"],
      } as any,
    );
    await ctx.runMutation(
      components.auth.public.enterpriseWebhookEndpointCreate,
      {
        enterpriseId,
        groupId,
        url: "https://hooks.example.com/b",
        status: "disabled",
        secretHash: "hash-b",
        subscriptions: ["enterprise.scim.configured"],
      } as any,
    );
    await ctx.runMutation(
      components.auth.public.enterpriseWebhookEndpointCreate,
      {
        enterpriseId,
        groupId,
        url: "https://hooks.example.com/c",
        status: "active",
        secretHash: "hash-c",
        subscriptions: ["enterprise.other"],
      } as any,
    );
  });

  const configured = await t.run(async (ctx) => {
    return await auth.sso.scim.configure(ctx as any, {
      enterpriseId,
      deprovisionMode: "soft",
    });
  });

  const scimConfig = await t.run(async (ctx) => {
    return await auth.sso.scim.get(ctx as any, enterpriseId);
  });
  const lookedUpByToken = await t.run(async (ctx) => {
    return await auth.sso.scim.getConfigByToken(ctx as any, configured.token);
  });
  const auditEvents = await t.run(async (ctx) => {
    return await ctx.runQuery(components.auth.public.enterpriseAuditEventList, {
      enterpriseId,
      limit: 10,
    });
  });
  const deliveries = await t.run(async (ctx) => {
    return await ctx.runQuery(
      components.auth.public.enterpriseWebhookDeliveryListReady,
      {
        now: Date.now(),
        limit: 10,
      },
    );
  });

  expect(configured.token).toBeTruthy();
  expect(scimConfig?.tokenHash).not.toBe(configured.token);
  expect(scimConfig?.basePath).toBe(
    `${ENTERPRISE_SITE_URL}/api/auth/sso/${enterpriseId}/scim/v2`,
  );
  expect(scimConfig?.deprovisionMode).toBe("soft");
  expect(lookedUpByToken?._id).toBe(scimConfig?._id);
  expect(auditEvents[0]?.eventType).toBe("enterprise.scim.configured");
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.enterpriseId).toBe(enterpriseId);
});
