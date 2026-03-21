import { randomBytes } from "node:crypto";

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { expect, test } from "vite-plus/test";

import {
  buildFormBody,
  cookieHeader,
  type ConvexSessionStartResult,
  extractAuthRequestId,
  extractSamlRequestIdFromLoginUrl,
  getInteropRuntime,
  normalizeRuntimeIssuer,
  parseSamlPostFormFromHtml,
  parseSetCookieHeaders,
  rewriteUrlForHostAccess,
  type SimpleResponse,
  updateCookieJar,
  enterpriseAuditListRpc,
  enterpriseConnectionCreateRpc,
  enterpriseOidcConfigureRpc,
  enterpriseSamlConfigureRpc,
  enterpriseScimConfigureRpc,
  randomSlug,
  requestHttp,
  requestJson,
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

async function startEnterpriseContext(prefix: string) {
  const { convexApiUrl, convexSiteUrl } = getInteropRuntime();
  const convexClient = new ConvexHttpClient(convexApiUrl, {
    skipConvexDeploymentUrlCheck: true,
    logger: false,
  });

  const passkeyStart = (await convexClient.action((api as any).auth.signIn, {
    provider: "passkey",
    params: { flow: "authOptions" },
  })) as ConvexPasskeyStartResult;
  expect(passkeyStart.kind).toBe("passkeyOptions");
  const verifier = passkeyStart.verifier;
  expect(verifier).toBeTruthy();
  if (!verifier) {
    throw new Error("Passkey flow did not return a verifier.");
  }

  const sessionStart = (await convexClient.action((api as any).auth.signIn, {
    provider: "anonymous",
  })) as ConvexSessionStartResult;
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
    { enterpriseId: args.enterpriseId },
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

test("SCIM + OIDC reuses provisioned userId", async () => {
  const { zitadelBaseUrl, zitadelRuntimeBaseUrl, managementToken, loginToken } =
    getInteropRuntime();

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
    issuer: normalizeRuntimeIssuer(zitadelBaseUrl),
    discoveryUrl: `${zitadelRuntimeBaseUrl}/.well-known/openid-configuration`,
    clientId: oidcClientId!,
    clientSecret: oidcClientSecret,
    scopes: ["openid", "profile", "email"],
  });

  const signInUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/oidc/signin?code=${encodeURIComponent(verifier)}&redirectTo=${encodeURIComponent(redirectTo)}`;
  const convexCookies = new Map<string, string>();
  const signInResponse = await requestHttp(signInUrl);
  if (signInResponse.status !== 302) {
    throw new Error(
      `OIDC signin failed: ${signInResponse.status} ${await signInResponse.text()}`,
    );
  }
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
    zitadelBaseUrl,
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
    rewriteUrlForHostAccess(callbackUrl, zitadelRuntimeBaseUrl, zitadelBaseUrl),
    { headers: { Cookie: cookieHeader(convexCookies) ?? "" } },
  );
  const completionLocation = callbackResponse.headers.get("location");
  if (!completionLocation) {
    throw new Error("Enterprise callback did not return completion redirect.");
  }
  const verificationCode = new URL(completionLocation).searchParams.get("code");
  expect(verificationCode).toBeTruthy();

  const exchanged = (await convexClient.action((api as any).auth.signIn, {
    params: { code: verificationCode! },
    verifier,
  })) as ConvexSessionStartResult;
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
}, 60_000);

test("SCIM + SAML reuses provisioned userId", async () => {
  const { zitadelBaseUrl, zitadelRuntimeBaseUrl, managementToken, loginToken } =
    getInteropRuntime();

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
  const verificationCode = new URL(completionLocation).searchParams.get("code");
  expect(verificationCode).toBeTruthy();

  const exchanged = (await convexClient.action((api as any).auth.signIn, {
    params: { code: verificationCode! },
    verifier,
  })) as ConvexSessionStartResult;
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
}, 60_000);
