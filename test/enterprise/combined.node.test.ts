import { randomBytes } from "node:crypto";

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { expect, inject, test } from "vite-plus/test";

import {
  type ConvexSessionStartResult,
  type SimpleResponse,
  enterpriseAuditListRpc,
  enterpriseConnectionCreateRpc,
  enterpriseOidcConfigureRpc,
  enterpriseSamlConfigureRpc,
  enterpriseScimConfigureRpc,
  randomSlug,
  requireEnv,
  requestHttp,
  requestJson,
  trimTrailingSlash,
} from "./_helpers.js";

type ConvexPasskeyStartResult = {
  kind: string;
  verifier?: string | null;
};

type ZitadelProjectResponse = {
  id?: string;
};

type ZitadelOidcAppResponse = {
  clientId?: string;
  clientSecret?: string;
  client_id?: string;
  client_secret?: string;
};

type ZitadelAddHumanUserResponse = {
  userId?: string;
  user_id?: string;
};

type ZitadelCreateSessionResponse = {
  sessionId?: string;
  sessionToken?: string;
  session_id?: string;
  session_token?: string;
};

type ZitadelCreateCallbackResponse = {
  callbackUrl?: string;
  callback_url?: string;
};

type ZitadelSamlAppResponse = {
  appId?: string;
  app_id?: string;
};

type ZitadelSamlRequestDetails = {
  samlRequest?: { id?: string };
};

type ZitadelFinalizeSamlResponse = {
  url?: string;
  post?: {
    relayState?: string;
    samlResponse?: string;
  };
  binding?: {
    post?: {
      relayState?: string;
      samlResponse?: string;
    };
  };
};

type ScimUser = {
  id?: string;
};

type EnterpriseAuditEvent = {
  eventType?: string;
  subjectId?: string;
};

declare module "vite-plus/test" {
  interface ProvidedContext {
    zitadelAdminPat: string;
    zitadelLoginClientPat: string;
  }
}

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
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
    sub?: string;
  };
}

function parseUserIdFromToken(token: string) {
  const subject = parseJwtPayload(token).sub;
  if (!subject) {
    throw new Error("JWT subject missing.");
  }
  const [userId] = subject.split("|");
  if (!userId) {
    throw new Error(`Invalid JWT subject: ${subject}`);
  }
  return userId;
}

function normalizeRuntimeIssuer(value: string) {
  return `${trimTrailingSlash(value)}/`;
}

function parseSetCookieHeaders(response: {
  headers: Headers & { getSetCookie?: () => string[] };
}) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    return [] as string[];
  }

  const result: string[] = [];
  let current = "";
  let inExpires = false;
  for (let i = 0; i < setCookie.length; i += 1) {
    const char = setCookie[i];
    const next = setCookie[i + 1];
    current += char;
    if (current.toLowerCase().endsWith("expires=")) {
      inExpires = true;
      continue;
    }
    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }
    if (!inExpires && char === "," && next === " ") {
      result.push(current.slice(0, -1).trim());
      current = "";
      i += 1;
    }
  }
  if (current.trim() !== "") {
    result.push(current.trim());
  }
  return result;
}

function updateCookieJar(jar: Map<string, string>, setCookies: string[]) {
  for (const raw of setCookies) {
    const [cookiePair] = raw.split(";");
    if (!cookiePair) {
      continue;
    }
    const index = cookiePair.indexOf("=");
    if (index < 1) {
      continue;
    }
    const name = cookiePair.slice(0, index).trim();
    const value = cookiePair.slice(index + 1).trim();
    if (value === "") {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

function cookieHeader(jar: Map<string, string>) {
  if (jar.size === 0) {
    return undefined;
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function rewriteUrlForHostAccess(
  url: string,
  runtimeBaseUrl: string,
  publicBaseUrl: string,
) {
  if (!url.startsWith(runtimeBaseUrl)) {
    return url;
  }
  return `${publicBaseUrl}${url.slice(runtimeBaseUrl.length)}`;
}

function extractAuthRequestId(location: string) {
  const url = new URL(location, requireEnv("ZITADEL_BASE_URL"));
  for (const key of [
    "authRequest",
    "auth_request",
    "authRequestId",
    "auth_request_id",
  ]) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Unable to extract auth request id from ${location}`);
}

function extractSamlRequestIdFromLoginUrl(location: string, base?: string) {
  const url = new URL(location, base);
  for (const key of [
    "samlRequest",
    "saml_request",
    "samlRequestId",
    "saml_request_id",
    "authRequest",
    "auth_request",
    "authRequestId",
    "auth_request_id",
  ]) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Could not find saml request id in location: ${location}`);
}

function parseSamlPostFormFromHtml(html: string) {
  const actionMatch = html.match(/<form[^>]+action="([^"]+)"/i);
  if (!actionMatch) {
    throw new Error("Could not find form action in SAML POST response.");
  }
  const fields: Record<string, string> = {};
  for (const pattern of [
    /<input[^>]+name="([^"]*)"[^>]+value="([^"]*)"/gi,
    /<input[^>]+value="([^"]*)"[^>]+name="([^"]*)"/gi,
  ]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      if (pattern.source.includes('name="([^"]*)"')) {
        fields[match[1]] = match[2].replace(/&amp;/g, "&");
      } else if (!(match[2] in fields)) {
        fields[match[2]] = match[1].replace(/&amp;/g, "&");
      }
    }
  }
  return {
    action: actionMatch[1].replace(/&amp;/g, "&"),
    fields,
  };
}

function buildFormBody(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

async function startEnterpriseContext(prefix: string) {
  const convexApiUrl = trimTrailingSlash(requireEnv("TEST_TARGET_BASE_URL"));
  const convexSiteUrl = trimTrailingSlash(requireEnv("CONVEX_SITE_URL"));
  const convexClient = new ConvexHttpClient(convexApiUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });

  const passkeyStart = (await convexClient.action(
    (api as any)["auth/session"].start,
    {
      provider: "passkey",
      params: { flow: "authOptions" },
    },
  )) as ConvexPasskeyStartResult;
  expect(passkeyStart.kind).toBe("passkeyOptions");
  const verifier = passkeyStart.verifier;
  expect(verifier).toBeTruthy();
  if (!verifier) {
    throw new Error("Passkey flow did not return a verifier.");
  }

  const sessionStart = (await convexClient.action(
    (api as any)["auth/session"].start,
    {
      provider: "anonymous",
    },
  )) as ConvexSessionStartResult;
  expect(sessionStart.kind).toBe("signedIn");
  const convexUserToken = sessionStart.tokens?.token;
  expect(convexUserToken).toBeTruthy();
  if (!convexUserToken) {
    throw new Error("Anonymous sign-in did not return a user token.");
  }

  const runId = randomSlug(prefix);
  const enterpriseCreated = await enterpriseConnectionCreateRpc(
    convexClient,
    convexUserToken,
    {
      name: `${prefix} ${runId}`,
      slug: runId,
      status: "active",
    },
  );
  expect(enterpriseCreated.enterpriseId).toBeTruthy();

  return {
    convexApiUrl,
    convexSiteUrl,
    convexClient,
    convexUserToken,
    enterpriseId: enterpriseCreated.enterpriseId,
    runId,
    verifier,
  };
}

async function configureScimAndProvisionUser(args: {
  convexClient: ConvexHttpClient;
  convexSiteUrl: string;
  convexUserToken: string;
  enterpriseId: string;
  email: string;
  externalId: string;
}) {
  const scimConfigured = await enterpriseScimConfigureRpc(
    args.convexClient,
    args.convexUserToken,
    {
      enterpriseId: args.enterpriseId,
      deprovisionMode: "soft",
    },
  );
  const scimToken = scimConfigured.token;
  expect(scimToken).toBeTruthy();
  if (!scimToken) {
    throw new Error("SCIM configuration did not return a token.");
  }

  const scimUser = await requestJson<ScimUser>(
    `${args.convexSiteUrl}/api/auth/sso/${args.enterpriseId}/scim/v2/Users`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${scimToken}`,
        Accept: "application/scim+json",
        "Content-Type": "application/scim+json",
      },
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: args.externalId,
        userName: args.email,
        emails: [{ value: args.email, primary: true }],
        name: { givenName: "Combined", familyName: "User" },
        active: true,
      }),
    },
  );
  expect(scimUser.id).toBeTruthy();
  return { scimToken, provisionedUserId: scimUser.id! };
}

const shouldRunInterop =
  process.env.ZITADEL_INTEROP_TEST === "true" &&
  process.env.ENTERPRISE_MANAGEMENT_API_TEST === "true";
const maybeInterop = shouldRunInterop ? test : test.skip;

maybeInterop(
  "SCIM + OIDC reuses provisioned userId",
  async () => {
    const zitadelBaseUrl = trimTrailingSlash(requireEnv("ZITADEL_BASE_URL"));
    const zitadelRuntimeBaseUrl = trimTrailingSlash(
      requireEnv("ZITADEL_RUNTIME_BASE_URL"),
    );
    const managementToken = inject("zitadelAdminPat");
    const loginToken = inject("zitadelLoginClientPat") || managementToken;

    const {
      convexSiteUrl,
      convexClient,
      convexUserToken,
      enterpriseId,
      runId,
      verifier,
    } = await startEnterpriseContext("combined-oidc");

    const email = `${runId}@example.com`;

    const enterpriseCallbackUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/oidc/callback`;
    const redirectTo = "https://example.com/callback";

    const project = await requestJson<ZitadelProjectResponse>(
      `${zitadelBaseUrl}/management/v1/projects`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `combined-oidc-${runId}`,
          projectRoleAssertion: true,
          projectRoleCheck: false,
          hasProjectCheck: false,
        }),
      },
    );
    const projectId = project.id;
    expect(projectId).toBeTruthy();

    const oidcApp = await requestJson<ZitadelOidcAppResponse>(
      `${zitadelBaseUrl}/management/v1/projects/${projectId}/apps/oidc`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          name: `combined-oidc-app-${runId}`,
          redirectUris: [enterpriseCallbackUrl],
          responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
          grantTypes: [
            "OIDC_GRANT_TYPE_AUTHORIZATION_CODE",
            "OIDC_GRANT_TYPE_REFRESH_TOKEN",
          ],
          appType: "OIDC_APP_TYPE_WEB",
          authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
          postLogoutRedirectUris: [redirectTo],
          version: "OIDC_VERSION_1_0",
          devMode: true,
          accessTokenType: "OIDC_TOKEN_TYPE_BEARER",
        }),
      },
    );
    const oidcClientId = oidcApp.clientId ?? oidcApp.client_id;
    const oidcClientSecret = oidcApp.clientSecret ?? oidcApp.client_secret;
    expect(oidcClientId).toBeTruthy();
    expect(oidcClientSecret).toBeTruthy();

    const password = `Combined-${randomBytes(8).toString("hex")}!`;
    const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
      `${zitadelBaseUrl}/management/v1/users/human`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: `combined-oidc-${runId}`,
          profile: {
            firstName: "Combined",
            lastName: "OIDC",
            displayName: "Combined OIDC",
            preferredLanguage: "en",
            gender: "GENDER_UNSPECIFIED",
          },
          email: { email, isEmailVerified: true },
          initialPassword: password,
        }),
      },
    );
    const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
    expect(zitadelUserId).toBeTruthy();

    const { provisionedUserId } = await configureScimAndProvisionUser({
      convexClient,
      convexSiteUrl,
      convexUserToken,
      enterpriseId,
      email,
      externalId: zitadelUserId!,
    });

    await requestJson<Record<string, never>>(
      `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password, noChangeRequired: true }),
      },
    );

    await enterpriseOidcConfigureRpc(convexClient, convexUserToken, {
      enterpriseId,
      issuer: normalizeRuntimeIssuer(zitadelRuntimeBaseUrl),
      discoveryUrl: `${zitadelRuntimeBaseUrl}/.well-known/openid-configuration`,
      clientId: oidcClientId!,
      clientSecret: oidcClientSecret,
      scopes: ["openid", "profile", "email"],
    });

    const signInUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/oidc/signin?code=${encodeURIComponent(verifier)}&redirectTo=${encodeURIComponent(redirectTo)}`;
    const convexCookies = new Map<string, string>();
    const signInResponse = await requestHttp(signInUrl);
    updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));
    const authorizeLocation = signInResponse.headers.get("location");
    if (!authorizeLocation) {
      throw new Error("OIDC signin did not return an authorization redirect.");
    }

    const authorizeResponse = await requestHttp(
      rewriteUrlForHostAccess(
        authorizeLocation,
        zitadelRuntimeBaseUrl,
        zitadelBaseUrl,
      ),
    );
    const authRequestLocation = authorizeResponse.headers.get("location");
    if (!authRequestLocation) {
      throw new Error(
        "Authorize endpoint did not return an auth request redirect.",
      );
    }
    const authRequestId = extractAuthRequestId(
      rewriteUrlForHostAccess(
        authRequestLocation,
        zitadelRuntimeBaseUrl,
        zitadelBaseUrl,
      ),
    );

    const session = await requestJson<ZitadelCreateSessionResponse>(
      `${zitadelBaseUrl}/v2/sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checks: { user: { userId: zitadelUserId }, password: { password } },
        }),
      },
    );
    const sessionId = session.sessionId ?? session.session_id;
    const sessionToken = session.sessionToken ?? session.session_token;
    expect(sessionId).toBeTruthy();
    expect(sessionToken).toBeTruthy();

    const callback = await requestJson<ZitadelCreateCallbackResponse>(
      `${zitadelBaseUrl}/v2/oidc/auth_requests/${authRequestId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: { sessionId, sessionToken } }),
      },
    );
    const callbackUrl = callback.callbackUrl ?? callback.callback_url;
    if (!callbackUrl) {
      throw new Error("ZITADEL callback URL was not returned.");
    }

    const callbackResponse = await requestHttp(
      rewriteUrlForHostAccess(
        callbackUrl,
        zitadelRuntimeBaseUrl,
        zitadelBaseUrl,
      ),
      { headers: { Cookie: cookieHeader(convexCookies) ?? "" } },
    );
    const completionLocation = callbackResponse.headers.get("location");
    if (!completionLocation) {
      throw new Error(
        "Enterprise callback did not return completion redirect.",
      );
    }
    const verificationCode = new URL(completionLocation).searchParams.get(
      "code",
    );
    expect(verificationCode).toBeTruthy();

    const exchanged = (await convexClient.action(
      (api as any)["auth/session"].start,
      {
        params: { code: verificationCode! },
        verifier,
      },
    )) as ConvexSessionStartResult;
    expect(exchanged.kind).toBe("signedIn");
    expect(exchanged.tokens?.token).toBeTruthy();

    const signedInUserId = parseUserIdFromToken(exchanged.tokens!.token);
    expect(signedInUserId).toBe(provisionedUserId);

    const auditEvents = (await enterpriseAuditListRpc(
      convexClient,
      convexUserToken,
      { enterpriseId, limit: 50 },
    )) as EnterpriseAuditEvent[];
    expect(
      auditEvents.some(
        (event) =>
          event.eventType === "enterprise.scim.user.created" &&
          event.subjectId === provisionedUserId,
      ),
    ).toBe(true);
  },
  60_000,
);

maybeInterop(
  "SCIM + SAML reuses provisioned userId",
  async () => {
    const zitadelBaseUrl = trimTrailingSlash(requireEnv("ZITADEL_BASE_URL"));
    const zitadelRuntimeBaseUrl = trimTrailingSlash(
      requireEnv("ZITADEL_RUNTIME_BASE_URL"),
    );
    const managementToken = inject("zitadelAdminPat");
    const loginToken = inject("zitadelLoginClientPat") || managementToken;

    const {
      convexSiteUrl,
      convexClient,
      convexUserToken,
      enterpriseId,
      runId,
      verifier,
    } = await startEnterpriseContext("combined-saml");

    const email = `${runId}@example.com`;

    const redirectTo = "https://example.com/callback";
    const convexAcsUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/acs`;
    const convexEntityId = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/metadata`;
    const spMetadataXml = [
      `<?xml version="1.0"?>`,
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${convexEntityId}">`,
      `  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
      `    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${convexAcsUrl}" index="1"/>`,
      `  </md:SPSSODescriptor>`,
      `</md:EntityDescriptor>`,
    ].join("\n");

    const project = await requestJson<ZitadelProjectResponse>(
      `${zitadelBaseUrl}/management/v1/projects`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `combined-saml-${runId}`,
          projectRoleAssertion: true,
          projectRoleCheck: false,
          hasProjectCheck: false,
        }),
      },
    );
    const projectId = project.id;
    expect(projectId).toBeTruthy();

    const samlApp = await requestJson<ZitadelSamlAppResponse>(
      `${zitadelBaseUrl}/management/v1/projects/${projectId}/apps/saml`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `combined-saml-app-${runId}`,
          metadataXml: Buffer.from(spMetadataXml).toString("base64"),
        }),
      },
    );
    expect(samlApp.appId ?? samlApp.app_id).toBeTruthy();

    const idpMetadataResponse = await requestHttp(
      `${zitadelBaseUrl}/saml/v2/metadata`,
    );
    expect(idpMetadataResponse.status).toBe(200);
    const idpMetadataXml = await idpMetadataResponse.text();

    await enterpriseSamlConfigureRpc(convexClient, convexUserToken, {
      enterpriseId,
      metadataXml: idpMetadataXml,
      signAuthnRequests: false,
      attributeMapping: {
        subject: "UserID",
        email: "Email",
        name: "FullName",
        firstName: "FirstName",
        lastName: "SurName",
      },
    });

    const password = `Saml-${randomBytes(8).toString("hex")}!`;
    const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
      `${zitadelBaseUrl}/management/v1/users/human`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: `combined-saml-${runId}`,
          profile: {
            firstName: "Combined",
            lastName: "SAML",
            displayName: "Combined SAML",
            preferredLanguage: "en",
            gender: "GENDER_UNSPECIFIED",
          },
          email: { email, isEmailVerified: true },
          initialPassword: password,
        }),
      },
    );
    const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
    expect(zitadelUserId).toBeTruthy();

    const { provisionedUserId } = await configureScimAndProvisionUser({
      convexClient,
      convexSiteUrl,
      convexUserToken,
      enterpriseId,
      email,
      externalId: zitadelUserId!,
    });

    await requestJson<Record<string, never>>(
      `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password, noChangeRequired: true }),
      },
    );

    const signInUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/signin?code=${encodeURIComponent(verifier)}&redirectTo=${encodeURIComponent(redirectTo)}`;
    const convexCookies = new Map<string, string>();
    const signInResponse = await requestHttp(signInUrl);
    updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));

    let samlRequestId: string;
    if (signInResponse.status === 302) {
      const signInLocation = signInResponse.headers.get("location");
      if (!signInLocation) {
        throw new Error("SAML signin did not return a redirect.");
      }
      const ssoResponse = await requestHttp(
        rewriteUrlForHostAccess(
          signInLocation,
          zitadelRuntimeBaseUrl,
          zitadelBaseUrl,
        ),
      );
      const loginLocation = ssoResponse.headers.get("location");
      if (!loginLocation) {
        throw new Error("ZITADEL SSO did not redirect to login UI.");
      }
      samlRequestId = extractSamlRequestIdFromLoginUrl(
        loginLocation,
        zitadelBaseUrl,
      );
    } else {
      const html = await signInResponse.text();
      const { action, fields } = parseSamlPostFormFromHtml(html);
      const ssoResponse = await requestHttp(
        rewriteUrlForHostAccess(action, zitadelRuntimeBaseUrl, zitadelBaseUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: buildFormBody(fields),
        },
      );
      const loginLocation = ssoResponse.headers.get("location");
      if (!loginLocation) {
        throw new Error("ZITADEL SSO POST did not redirect to login UI.");
      }
      samlRequestId = extractSamlRequestIdFromLoginUrl(
        loginLocation,
        zitadelBaseUrl,
      );
    }

    const samlRequestDetails = await requestJson<ZitadelSamlRequestDetails>(
      `${zitadelBaseUrl}/v2/saml/saml_requests/${samlRequestId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
      },
    );
    expect(samlRequestDetails.samlRequest?.id).toBe(samlRequestId);

    const session = await requestJson<ZitadelCreateSessionResponse>(
      `${zitadelBaseUrl}/v2/sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checks: { user: { userId: zitadelUserId }, password: { password } },
        }),
      },
    );
    const sessionId = session.sessionId ?? session.session_id;
    const sessionToken = session.sessionToken ?? session.session_token;
    expect(sessionId).toBeTruthy();
    expect(sessionToken).toBeTruthy();

    const finalized = await requestJson<ZitadelFinalizeSamlResponse>(
      `${zitadelBaseUrl}/v2/saml/saml_requests/${samlRequestId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session: { sessionId, sessionToken } }),
      },
    );
    expect(finalized.url).toBeTruthy();
    if (!finalized.url) {
      throw new Error("ZITADEL SAML finalization did not return a url.");
    }

    let acsResponse: SimpleResponse;
    const postBinding = finalized.post ?? finalized.binding?.post;
    if (postBinding) {
      if (!postBinding.samlResponse) {
        throw new Error(
          "ZITADEL SAML POST binding did not include samlResponse.",
        );
      }
      acsResponse = await requestHttp(
        rewriteUrlForHostAccess(
          finalized.url,
          zitadelRuntimeBaseUrl,
          convexSiteUrl,
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookieHeader(convexCookies) ?? "",
          },
          body: buildFormBody({
            SAMLResponse: postBinding.samlResponse,
            ...(postBinding.relayState
              ? { RelayState: postBinding.relayState }
              : {}),
          }),
        },
      );
    } else {
      acsResponse = await requestHttp(
        rewriteUrlForHostAccess(
          finalized.url,
          zitadelRuntimeBaseUrl,
          convexSiteUrl,
        ),
        { headers: { Cookie: cookieHeader(convexCookies) ?? "" } },
      );
    }

    const completionLocation = acsResponse.headers.get("location");
    if (!completionLocation) {
      throw new Error("Convex SAML ACS did not return a completion redirect.");
    }
    const verificationCode = new URL(completionLocation).searchParams.get(
      "code",
    );
    expect(verificationCode).toBeTruthy();

    const exchanged = (await convexClient.action(
      (api as any)["auth/session"].start,
      {
        params: { code: verificationCode! },
        verifier,
      },
    )) as ConvexSessionStartResult;
    expect(exchanged.kind).toBe("signedIn");
    expect(exchanged.tokens?.token).toBeTruthy();

    const signedInUserId = parseUserIdFromToken(exchanged.tokens!.token);
    expect(signedInUserId).toBe(provisionedUserId);

    const auditEvents = (await enterpriseAuditListRpc(
      convexClient,
      convexUserToken,
      { enterpriseId, limit: 50 },
    )) as EnterpriseAuditEvent[];
    expect(
      auditEvents.some(
        (event) =>
          event.eventType === "enterprise.scim.user.created" &&
          event.subjectId === provisionedUserId,
      ),
    ).toBe(true);
  },
  60_000,
);
