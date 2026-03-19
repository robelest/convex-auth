import { randomBytes } from "node:crypto";

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";
import { expect, inject, test } from "vite-plus/test";

import {
  type ConvexSessionStartResult,
  type SimpleResponse,
  enterpriseConnectionCreateRpc,
  enterpriseOidcConfigureRpc,
  enterpriseSamlConfigureRpc,
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
  appId?: string;
  app_id?: string;
  clientId?: string;
  client_id?: string;
  clientSecret?: string;
  client_secret?: string;
};

type ZitadelAddHumanUserResponse = {
  userId?: string;
  user_id?: string;
};

type ZitadelCreateSessionResponse = {
  sessionId?: string;
  session_id?: string;
  sessionToken?: string;
  session_token?: string;
};

type ZitadelCreateCallbackResponse = {
  callbackUrl?: string;
  callback_url?: string;
};

type ZitadelSamlAppResponse = {
  appId?: string;
  app_id?: string;
  entityId?: string;
  entity_id?: string;
};

type ZitadelSamlRequestDetails = {
  samlRequest?: {
    id?: string;
    issuer?: string;
    assertionConsumerService?: string;
    relayState?: string;
    binding?: string;
  };
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
    redirect?: Record<string, never>;
  };
};

declare module "vite-plus/test" {
  interface ProvidedContext {
    zitadelAdminPat: string;
    zitadelLoginClientPat: string;
  }
}

function normalizeRuntimeIssuer(value: string) {
  const trimmed = trimTrailingSlash(value);
  return `${trimmed}/`;
}

function parseSetCookieHeaders(response: {
  headers: Headers & { getSetCookie?: () => string[] };
}) {
  const headersWithSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithSetCookie.getSetCookie === "function") {
    return headersWithSetCookie.getSetCookie();
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

function extractAuthRequestId(location: string) {
  const url = new URL(location);
  const keys = [
    "authRequest",
    "auth_request",
    "authRequestId",
    "auth_request_id",
  ];
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Unable to extract auth request id from ${location}`);
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

function extractSamlRequestIdFromLoginUrl(location: string, base?: string) {
  const url = new URL(location, base);
  const keys = [
    "samlRequest",
    "saml_request",
    "samlRequestId",
    "saml_request_id",
    "authRequest",
    "auth_request",
    "authRequestId",
    "auth_request_id",
  ];
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Could not find saml request id in location: ${location}`);
}

function parseSamlPostFormFromHtml(html: string): {
  action: string;
  fields: Record<string, string>;
} {
  const actionMatch = html.match(/<form[^>]+action="([^"]+)"/i);
  if (!actionMatch) {
    throw new Error("Could not find form action in SAML POST response.");
  }
  const action = actionMatch[1].replace(/&amp;/g, "&");
  const fields: Record<string, string> = {};
  const inputPattern = /<input[^>]+name="([^"]*)"[^>]+value="([^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = inputPattern.exec(html)) !== null) {
    fields[match[1]] = match[2].replace(/&amp;/g, "&");
  }
  const inputPatternRev = /<input[^>]+value="([^"]*)"[^>]+name="([^"]*)"/gi;
  while ((match = inputPatternRev.exec(html)) !== null) {
    if (!(match[2] in fields)) {
      fields[match[2]] = match[1].replace(/&amp;/g, "&");
    }
  }
  return { action, fields };
}

function buildFormBody(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

const shouldRunInterop =
  process.env.ZITADEL_INTEROP_TEST === "true" &&
  process.env.ENTERPRISE_MANAGEMENT_API_TEST === "true";

const maybeInterop = shouldRunInterop ? test : test.skip;

maybeInterop(
  "enterprise oidc login interoperates with zitadel through api-driven flow",
  async () => {
    const convexApiUrl = trimTrailingSlash(requireEnv("TEST_TARGET_BASE_URL"));
    const convexSiteUrl = trimTrailingSlash(requireEnv("CONVEX_SITE_URL"));
    const zitadelBaseUrl = trimTrailingSlash(requireEnv("ZITADEL_BASE_URL"));
    const zitadelRuntimeBaseUrl = trimTrailingSlash(
      requireEnv("ZITADEL_RUNTIME_BASE_URL"),
    );

    const managementToken = inject("zitadelAdminPat");
    const loginToken = inject("zitadelLoginClientPat") || managementToken;

    const convexClient = new ConvexHttpClient(convexApiUrl, {
      skipConvexDeploymentUrlCheck: true,
      logger: false,
    });

    const passkeyStart = (await convexClient.action(
      (api as any)["auth/session"].start,
      {
        provider: "passkey",
        params: {
          flow: "authOptions",
        },
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

    const runId = randomSlug("zitadel-interop");
    const enterpriseCreated = await enterpriseConnectionCreateRpc(
      convexClient,
      convexUserToken!,
      {
        name: `Zitadel Interop ${runId}`,
        slug: runId,
        status: "active",
      },
    );

    const enterpriseId = enterpriseCreated.enterpriseId;
    expect(enterpriseId).toBeTruthy();

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
          name: `convex-auth-${runId}`,
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
          name: `convex-auth-oidc-${runId}`,
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

    const zitadelUserPassword = `Zitadel-${randomBytes(8).toString("hex")}!`;
    const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
      `${zitadelBaseUrl}/management/v1/users/human`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: `convex-auth-${runId}`,
          profile: {
            firstName: "Convex",
            lastName: "Auth",
            displayName: "Convex Auth",
            preferredLanguage: "en",
            gender: "GENDER_UNSPECIFIED",
          },
          email: {
            email: `${runId}@example.com`,
            isEmailVerified: true,
          },
          initialPassword: zitadelUserPassword,
        }),
      },
    );

    const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
    expect(zitadelUserId).toBeTruthy();

    await requestJson<Record<string, never>>(
      `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: zitadelUserPassword,
          noChangeRequired: true,
        }),
      },
    );

    await enterpriseOidcConfigureRpc(convexClient, convexUserToken!, {
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
    expect(signInResponse.status).toBe(302);
    updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));

    const authorizeLocation = signInResponse.headers.get("location");
    if (!authorizeLocation) {
      throw new Error("OIDC signin did not return an authorization redirect.");
    }
    const authorizeUrl = rewriteUrlForHostAccess(
      authorizeLocation,
      zitadelRuntimeBaseUrl,
      zitadelBaseUrl,
    );

    const authorizeResponse = await requestHttp(authorizeUrl);
    expect(authorizeResponse.status).toBeGreaterThanOrEqual(300);
    expect(authorizeResponse.status).toBeLessThan(400);
    const authRequestLocation = authorizeResponse.headers.get("location");
    if (!authRequestLocation) {
      throw new Error(
        "Authorize endpoint did not return an auth request redirect.",
      );
    }

    const authRequestLocationForHost = rewriteUrlForHostAccess(
      authRequestLocation,
      zitadelRuntimeBaseUrl,
      zitadelBaseUrl,
    );
    const authRequestUrl = new URL(
      authRequestLocationForHost,
      `${zitadelBaseUrl}/`,
    ).toString();
    const authRequestId = extractAuthRequestId(authRequestUrl);

    const authRequest = await requestJson<{ authRequest?: { id?: string } }>(
      `${zitadelBaseUrl}/v2/oidc/auth_requests/${authRequestId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
      },
    );
    expect(authRequest.authRequest?.id).toBe(authRequestId);

    const session = await requestJson<ZitadelCreateSessionResponse>(
      `${zitadelBaseUrl}/v2/sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checks: {
            user: { userId: zitadelUserId },
            password: { password: zitadelUserPassword },
          },
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
        body: JSON.stringify({
          session: {
            sessionId,
            sessionToken,
          },
        }),
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
      {
        headers: {
          Cookie: cookieHeader(convexCookies) ?? "",
        },
      },
    );

    expect(callbackResponse.status).toBe(302);
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
    expect(exchanged.tokens?.refreshToken).toBeTruthy();
  },
);

maybeInterop(
  "enterprise saml login interoperates with zitadel through api-driven flow",
  async () => {
    const convexApiUrl = trimTrailingSlash(requireEnv("TEST_TARGET_BASE_URL"));
    const convexSiteUrl = trimTrailingSlash(requireEnv("CONVEX_SITE_URL"));
    const zitadelBaseUrl = trimTrailingSlash(requireEnv("ZITADEL_BASE_URL"));
    const zitadelRuntimeBaseUrl = trimTrailingSlash(
      requireEnv("ZITADEL_RUNTIME_BASE_URL"),
    );

    const managementToken = inject("zitadelAdminPat");
    const loginToken = inject("zitadelLoginClientPat") || managementToken;

    const convexClient = new ConvexHttpClient(convexApiUrl, {
      skipConvexDeploymentUrlCheck: true,
      logger: false,
    });

    // Step 1: Get verifier via passkey authOptions
    const passkeyStart = (await convexClient.action(
      (api as any)["auth/session"].start,
      { provider: "passkey", params: { flow: "authOptions" } },
    )) as ConvexPasskeyStartResult;

    expect(passkeyStart.kind).toBe("passkeyOptions");
    const verifier = passkeyStart.verifier;
    expect(verifier).toBeTruthy();
    if (!verifier) {
      throw new Error("Passkey flow did not return a verifier.");
    }

    // Step 2: Get admin bearer token via anonymous sign-in
    const sessionStart = (await convexClient.action(
      (api as any)["auth/session"].start,
      { provider: "anonymous" },
    )) as ConvexSessionStartResult;

    expect(sessionStart.kind).toBe("signedIn");
    const convexUserToken = sessionStart.tokens?.token;
    expect(convexUserToken).toBeTruthy();

    const runId = randomSlug("saml-interop");
    const redirectTo = "https://example.com/callback";

    // Step 3: Create enterprise
    const enterpriseCreated = await enterpriseConnectionCreateRpc(
      convexClient,
      convexUserToken!,
      {
        name: `SAML Interop ${runId}`,
        slug: runId,
        status: "active",
      },
    );

    const enterpriseId = enterpriseCreated.enterpriseId;
    expect(enterpriseId).toBeTruthy();

    // Step 4: Build Convex SP metadata locally from known deterministic values.
    // The metadata endpoint requires IdP metadata to already be registered, so
    // we construct a minimal SP metadata XML ourselves using the enterprise ACS
    // URL as entityID and AssertionConsumerService. This is what Convex would
    // generate once SAML is configured.
    const convexAcsUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/acs`;
    const convexEntityId = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/metadata`;
    const spMetadataXml = [
      `<?xml version="1.0"?>`,
      `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"`,
      `  entityID="${convexEntityId}">`,
      `  <md:SPSSODescriptor`,
      `    AuthnRequestsSigned="false"`,
      `    WantAssertionsSigned="true"`,
      `    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`,
      `    <md:AssertionConsumerService`,
      `      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"`,
      `      Location="${convexAcsUrl}"`,
      `      index="1"/>`,
      `  </md:SPSSODescriptor>`,
      `</md:EntityDescriptor>`,
    ].join("\n");

    // Step 5: Create ZITADEL project
    const project = await requestJson<ZitadelProjectResponse>(
      `${zitadelBaseUrl}/management/v1/projects`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `convex-auth-saml-${runId}`,
          projectRoleAssertion: true,
          projectRoleCheck: false,
          hasProjectCheck: false,
        }),
      },
    );
    const projectId = project.id;
    expect(projectId).toBeTruthy();

    // Step 6: Create ZITADEL SAML app using Convex SP metadata
    const samlApp = await requestJson<ZitadelSamlAppResponse>(
      `${zitadelBaseUrl}/management/v1/projects/${projectId}/apps/saml`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `convex-auth-saml-app-${runId}`,
          metadataXml: Buffer.from(spMetadataXml).toString("base64"),
        }),
      },
    );
    const samlAppId = samlApp.appId ?? samlApp.app_id;
    expect(samlAppId).toBeTruthy();

    // Step 7: Fetch ZITADEL IdP metadata XML
    const idpMetadataResponse = await requestHttp(
      `${zitadelBaseUrl}/saml/v2/metadata`,
    );
    expect(idpMetadataResponse.status).toBe(200);
    const idpMetadataXml = await idpMetadataResponse.text();
    expect(idpMetadataXml).toContain("EntityDescriptor");

    // Step 8: Register ZITADEL SAML in Convex
    await enterpriseSamlConfigureRpc(convexClient, convexUserToken!, {
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

    // Step 9: Create ZITADEL test user and set password
    const zitadelUserPassword = `Saml-${randomBytes(8).toString("hex")}!`;
    const zitadelUser = await requestJson<ZitadelAddHumanUserResponse>(
      `${zitadelBaseUrl}/management/v1/users/human`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userName: `saml-${runId}`,
          profile: {
            firstName: "SAML",
            lastName: "User",
            displayName: "SAML User",
            preferredLanguage: "en",
            gender: "GENDER_UNSPECIFIED",
          },
          email: {
            email: `${runId}@example.com`,
            isEmailVerified: true,
          },
          initialPassword: zitadelUserPassword,
        }),
      },
    );
    const zitadelUserId = zitadelUser.userId ?? zitadelUser.user_id;
    expect(zitadelUserId).toBeTruthy();

    await requestJson<Record<string, never>>(
      `${zitadelBaseUrl}/management/v1/users/${zitadelUserId}/password`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${managementToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: zitadelUserPassword,
          noChangeRequired: true,
        }),
      },
    );

    // Step 10: Start Convex SAML sign-in
    const signInUrl = `${convexSiteUrl}/api/auth/sso/${enterpriseId}/saml/signin?code=${encodeURIComponent(verifier)}&redirectTo=${encodeURIComponent(redirectTo)}`;
    const convexCookies = new Map<string, string>();

    const signInResponse = await requestHttp(signInUrl);
    updateCookieJar(convexCookies, parseSetCookieHeaders(signInResponse));

    // The SAML sign-in may return either a 302 redirect or an HTML POST form
    // depending on the IdP binding. Handle both.
    let samlRequestId: string;

    if (signInResponse.status === 302) {
      // Redirect binding: follow the redirect to ZITADEL SSO
      const signInLocation = signInResponse.headers.get("location");
      if (!signInLocation) {
        throw new Error("SAML signin did not return a redirect.");
      }

      const ssoUrl = rewriteUrlForHostAccess(
        signInLocation,
        zitadelRuntimeBaseUrl,
        zitadelBaseUrl,
      );
      const ssoResponse = await requestHttp(ssoUrl);
      expect(ssoResponse.status).toBeGreaterThanOrEqual(300);
      expect(ssoResponse.status).toBeLessThan(400);
      const loginLocation = ssoResponse.headers.get("location");
      if (!loginLocation) {
        throw new Error("ZITADEL SSO did not redirect to login UI.");
      }
      samlRequestId = extractSamlRequestIdFromLoginUrl(
        loginLocation,
        zitadelBaseUrl,
      );
    } else if (signInResponse.status === 200) {
      // POST binding: parse the HTML form and submit it to ZITADEL SSO
      const html = await signInResponse.text();
      const { action, fields } = parseSamlPostFormFromHtml(html);
      const ssoUrl = rewriteUrlForHostAccess(
        action,
        zitadelRuntimeBaseUrl,
        zitadelBaseUrl,
      );
      const formBody = buildFormBody(fields);
      const ssoResponse = await requestHttp(ssoUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
      });
      expect(ssoResponse.status).toBeGreaterThanOrEqual(300);
      expect(ssoResponse.status).toBeLessThan(400);
      const loginLocation = ssoResponse.headers.get("location");
      if (!loginLocation) {
        throw new Error("ZITADEL SSO POST did not redirect to login UI.");
      }
      samlRequestId = extractSamlRequestIdFromLoginUrl(
        loginLocation,
        zitadelBaseUrl,
      );
    } else {
      throw new Error(
        `Unexpected SAML sign-in response status: ${signInResponse.status}`,
      );
    }

    expect(samlRequestId).toBeTruthy();

    // Step 11: Inspect the SAML request
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

    // Step 12: Create authenticated ZITADEL session
    const session = await requestJson<ZitadelCreateSessionResponse>(
      `${zitadelBaseUrl}/v2/sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${loginToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checks: {
            user: { userId: zitadelUserId },
            password: { password: zitadelUserPassword },
          },
        }),
      },
    );
    const sessionId = session.sessionId ?? session.session_id;
    const sessionToken = session.sessionToken ?? session.session_token;
    expect(sessionId).toBeTruthy();
    expect(sessionToken).toBeTruthy();

    // Step 13: Finalize the ZITADEL SAML request
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

    // Step 14: Deliver SAML response to Convex ACS
    let acsResponse: SimpleResponse;

    // ZITADEL returns post fields either at top level or under binding.post
    const postBinding = finalized.post ?? finalized.binding?.post;

    if (postBinding) {
      // POST binding: submit SAMLResponse + RelayState as form POST to Convex ACS
      const { samlResponse, relayState } = postBinding;
      if (!samlResponse) {
        throw new Error(
          "ZITADEL SAML POST binding did not include samlResponse.",
        );
      }
      const acsUrl = rewriteUrlForHostAccess(
        finalized.url,
        zitadelRuntimeBaseUrl,
        convexSiteUrl,
      );
      const formBody = buildFormBody({
        SAMLResponse: samlResponse,
        ...(relayState ? { RelayState: relayState } : {}),
      });
      acsResponse = await requestHttp(acsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader(convexCookies) ?? "",
        },
        body: formBody,
      });
    } else {
      // Redirect binding: GET the returned URL which includes SAMLResponse as query param
      const acsUrl = rewriteUrlForHostAccess(
        finalized.url,
        zitadelRuntimeBaseUrl,
        convexSiteUrl,
      );
      acsResponse = await requestHttp(acsUrl, {
        headers: { Cookie: cookieHeader(convexCookies) ?? "" },
      });
    }

    expect(acsResponse.status).toBe(302);
    const completionLocation = acsResponse.headers.get("location");
    if (!completionLocation) {
      throw new Error("Convex SAML ACS did not return a completion redirect.");
    }

    const verificationCode = new URL(completionLocation).searchParams.get(
      "code",
    );
    expect(verificationCode).toBeTruthy();

    // Step 15: Exchange code for Convex session tokens
    const exchanged = (await convexClient.action(
      (api as any)["auth/session"].start,
      { params: { code: verificationCode! }, verifier },
    )) as ConvexSessionStartResult;

    expect(exchanged.kind).toBe("signedIn");
    expect(exchanged.tokens?.token).toBeTruthy();
    expect(exchanged.tokens?.refreshToken).toBeTruthy();
  },
  60_000,
);
