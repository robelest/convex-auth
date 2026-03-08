import { ConvexHttpClient } from "convex/browser";
import { afterEach, expect, test, vi } from "vitest";

import { parseAuthError } from "../../auth/src/server/errors";
import {
  auth_cookie_names,
  parse_auth_cookies,
  server,
} from "../../auth/src/server/index";
import {
  createOAuthAuthorizationURL,
  handleOAuthCallback,
} from "../../auth/src/server/oauth";
import { isLocalHost } from "../../auth/src/server/utils";

const TEST_COOKIE_NAMESPACE = "server_security_tests";

afterEach(() => {
  vi.restoreAllMocks();
});

test("isLocalHost accepts localhost hosts with or without ports", () => {
  expect(isLocalHost("localhost")).toBe(true);
  expect(isLocalHost("localhost:3000")).toBe(true);
  expect(isLocalHost("127.0.0.1")).toBe(true);
  expect(isLocalHost("127.0.0.1:8787")).toBe(true);
  expect(isLocalHost("http://localhost:5173")).toBe(true);
  expect(isLocalHost("https://127.0.0.1")).toBe(true);
  expect(isLocalHost("example.com")).toBe(false);
  expect(isLocalHost("localhost.example.com")).toBe(false);

  const localhostCookieNames = auth_cookie_names("localhost");
  expect(localhostCookieNames.token.startsWith("__Host-")).toBe(false);
});

test("auth_cookie_names isolates cookie namespaces", () => {
  const first = auth_cookie_names("localhost", "ledger_a");
  const second = auth_cookie_names("localhost", "ledger_b");

  expect(first.token).not.toBe(second.token);
  expect(first.refreshToken).not.toBe(second.refreshToken);
  expect(first.verifier).not.toBe(second.verifier);
});

test("parse_auth_cookies prefers namespaced cookies over legacy names", () => {
  const host = "localhost";
  const namespace = "ledger";
  const namespaced = auth_cookie_names(host, namespace);
  const legacy = auth_cookie_names(host);
  const parsed = parse_auth_cookies(
    `${legacy.token}=legacy-token; ${legacy.refreshToken}=legacy-refresh; ${legacy.verifier}=legacy-verifier; ` +
      `${namespaced.token}=namespaced-token; ${namespaced.refreshToken}=namespaced-refresh; ${namespaced.verifier}=namespaced-verifier`,
    host,
    namespace,
  );

  expect(parsed.token).toBe("namespaced-token");
  expect(parsed.refreshToken).toBe("namespaced-refresh");
  expect(parsed.verifier).toBe("namespaced-verifier");
});

test("OAuth callback rejects PKCE provider when verifier cookie is missing", async () => {
  const provider = {
    createAuthorizationURL(
      _state: string,
      _codeVerifier: string,
      _scopes: string[],
    ) {
      return new URL("https://accounts.example.com/oauth");
    },
    validateAuthorizationCode: vi.fn(),
  };

  const authResult = await createOAuthAuthorizationURL("google", provider, {});
  const stateCookie = authResult.cookies.find((cookie) =>
    cookie.name.endsWith("OAuthstate"),
  );
  expect(stateCookie).toBeDefined();

  await expect(
    handleOAuthCallback(
      "google",
      provider,
      {},
      { state: stateCookie!.value, code: "oauth-code" },
      {
        [stateCookie!.name]: stateCookie!.value,
      },
    ),
  ).rejects.toSatisfy((error: unknown) => {
    return parseAuthError(error)?.code === "OAUTH_MISSING_VERIFIER";
  });

  expect(provider.validateAuthorizationCode).not.toHaveBeenCalled();
});

test("refresh keeps existing session when code exchange fails transiently", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ConvexHttpClient.prototype, "action").mockRejectedValue(
    new Error("exchange failed"),
  );

  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const request = new Request("https://app.example.com/?code=abc", {
    method: "GET",
    headers: {
      host,
      accept: "text/html",
      cookie: `${cookieNames.token}=jwt-token; ${cookieNames.refreshToken}=refresh-token; ${cookieNames.verifier}=verifier-token`,
    },
  });

  const result = await auth.refresh(request);

  expect(result.redirect).toBeUndefined();
  expect(result.token).toBe("jwt-token");
  expect(result.cookies).toEqual([]);
});

test("refresh recovers from malformed access token with valid refresh token", async () => {
  vi.spyOn(ConvexHttpClient.prototype, "action").mockResolvedValue({
    tokens: {
      token: "new-jwt-token",
      refreshToken: "new-refresh-token",
    },
  });

  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=not-a-jwt; ${cookieNames.refreshToken}=refresh-token`,
    },
  });

  const result = await auth.refresh(request);

  expect(result.token).toBe("new-jwt-token");
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.token)?.value,
  ).toBe("new-jwt-token");
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.refreshToken)
      ?.value,
  ).toBe("new-refresh-token");
});

test("refresh does not mutate cookies for CORS requests", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      origin: "https://evil.example.com",
      cookie: `${cookieNames.token}=jwt-token; ${cookieNames.refreshToken}=refresh-token`,
    },
  });

  const result = await auth.refresh(request);
  expect(result.cookies).toEqual([]);
  expect(result.token).toBeNull();
});

test("refresh honors forwarded protocol when checking same-origin", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = unsignedToken({
    iss: "https://example.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("http://127.0.0.1/internal/dashboard", {
    method: "GET",
    headers: {
      host,
      origin: "https://app.example.com",
      "x-forwarded-proto": "https",
      cookie: `${cookieNames.token}=${token}; ${cookieNames.refreshToken}=refresh-token`,
    },
  });

  const result = await auth.refresh(request);
  expect(result.cookies).toEqual([]);
  expect(result.token).toBe(token);
});

test("verify accepts convex.site issuer for convex.cloud URL", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const siteToken = unsignedToken({
    iss: "https://example.convex.site",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${siteToken}`,
    },
  });

  await expect(auth.verify(request)).resolves.toBe(true);
});

test("verify accepts convex.cloud issuer for convex.cloud URL", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cloudToken = unsignedToken({
    iss: "https://example.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${cloudToken}`,
    },
  });

  await expect(auth.verify(request)).resolves.toBe(true);
});

test("verify supports accepted_issuers override", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    accepted_issuers: ["https://issuer.internal.example"],
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const customToken = unsignedToken({
    iss: "https://issuer.internal.example",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });
  const defaultToken = unsignedToken({
    iss: "https://example.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const customRequest = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${customToken}`,
    },
  });
  const defaultRequest = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${defaultToken}`,
    },
  });

  await expect(auth.verify(customRequest)).resolves.toBe(true);
  await expect(auth.verify(defaultRequest)).resolves.toBe(false);
});

test("verify rejects unrelated issuer tokens", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const foreignToken = unsignedToken({
    iss: "https://malicious.example.com",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${foreignToken}`,
    },
  });

  await expect(auth.verify(request)).resolves.toBe(false);
});

test("refresh keeps valid convex.site issuer token for convex.cloud URL", async () => {
  const actionSpy = vi
    .spyOn(ConvexHttpClient.prototype, "action")
    .mockResolvedValue({
      tokens: {
        token: "unexpected-token",
        refreshToken: "unexpected-refresh-token",
      },
    });

  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const siteToken = unsignedToken({
    iss: "https://example.convex.site",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${siteToken}; ${cookieNames.refreshToken}=refresh-token`,
    },
  });

  const result = await auth.refresh(request);
  expect(result.cookies).toEqual([]);
  expect(result.token).toBe(siteToken);
  expect(actionSpy).not.toHaveBeenCalled();
});

test("refresh clears foreign issuer token before expiry checks", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const foreignToken = unsignedToken({
    iss: "https://other-deployment.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${foreignToken}; ${cookieNames.refreshToken}=foreign-refresh-token`,
    },
  });

  const result = await auth.refresh(request);
  expect(result.token).toBeNull();
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.token)?.value,
  ).toBe("");
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.refreshToken)
      ?.value,
  ).toBe("");
});

test("refresh clears malformed refresh token values", async () => {
  const auth = server({
    url: "https://example.convex.cloud",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = unsignedToken({
    iss: "https://example.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/dashboard", {
    method: "GET",
    headers: {
      host,
      cookie: `${cookieNames.token}=${token}; ${cookieNames.refreshToken}=dummy`,
    },
  });

  const result = await auth.refresh(request);
  expect(result.token).toBeNull();
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.token)?.value,
  ).toBe("");
  expect(
    result.cookies.find((cookie) => cookie.name === cookieNames.refreshToken)
      ?.value,
  ).toBe("");
});

test("proxy refresh keeps valid access token when refresh cookie is missing", async () => {
  const actionSpy = vi.spyOn(ConvexHttpClient.prototype, "action");
  const auth = server({
    url: "https://example.convex.cloud",
    api_route: "/api/auth",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = unsignedToken({
    iss: "https://example.convex.cloud",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/api/auth", {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      cookie: `${cookieNames.token}=${token}`,
    },
    body: JSON.stringify({
      action: "auth/session:start",
      args: { refreshToken: true },
    }),
  });

  const response = await auth.proxy(request);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    tokens: {
      token,
      refreshToken: "dummy",
    },
  });
  expect(actionSpy).not.toHaveBeenCalled();
});

test("proxy refresh returns null when missing refresh cookie and access token is invalid", async () => {
  const actionSpy = vi.spyOn(ConvexHttpClient.prototype, "action");
  const auth = server({
    url: "https://example.convex.cloud",
    api_route: "/api/auth",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const token = unsignedToken({
    iss: "https://malicious.example.com",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  });

  const request = new Request("https://app.example.com/api/auth", {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      cookie: `${cookieNames.token}=${token}`,
    },
    body: JSON.stringify({
      action: "auth/session:start",
      args: { refreshToken: true },
    }),
  });

  const response = await auth.proxy(request);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ tokens: null });
  expect(actionSpy).not.toHaveBeenCalled();
});

test("proxy signIn errors keep existing cookies for non-refresh requests", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ConvexHttpClient.prototype, "action").mockRejectedValue(
    new Error("signIn failed"),
  );

  const auth = server({
    url: "https://example.convex.cloud",
    api_route: "/api/auth",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const request = new Request("https://app.example.com/api/auth", {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      cookie: `${cookieNames.token}=jwt-token; ${cookieNames.refreshToken}=refresh-token; ${cookieNames.verifier}=verifier-token`,
    },
    body: JSON.stringify({
      action: "auth/session:start",
      args: {
        provider: "password",
        params: { email: "sarah@gmail.com", password: "wrong", flow: "signIn" },
      },
    }),
  });

  const response = await auth.proxy(request);
  expect(response.status).toBe(400);

  const setCookie =
    typeof (response.headers as any).getSetCookie === "function"
      ? ((response.headers as any).getSetCookie() as string[]).join("\n")
      : (response.headers.get("set-cookie") ?? "");

  expect(setCookie).toContain(`${cookieNames.token}=jwt-token`);
  expect(setCookie).toContain(`${cookieNames.refreshToken}=refresh-token`);
  expect(setCookie).toContain(`${cookieNames.verifier}=`);
});

test("proxy signOut retries revocation via refresh token", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let signOutCalls = 0;
  vi.spyOn(ConvexHttpClient.prototype, "action").mockImplementation(
    async (_reference: unknown, args: any) => {
      if (typeof args === "object" && args !== null && "refreshToken" in args) {
        return {
          tokens: {
            token: "fresh-jwt-token",
            refreshToken: "fresh-refresh-token",
          },
        };
      }
      signOutCalls += 1;
      if (signOutCalls === 1) {
        throw new Error("signOut with expired JWT failed");
      }
      return null;
    },
  );

  const auth = server({
    url: "https://example.convex.cloud",
    api_route: "/api/auth",
    cookie_namespace: TEST_COOKIE_NAMESPACE,
  });
  const host = "app.example.com";
  const cookieNames = auth_cookie_names(host, TEST_COOKIE_NAMESPACE);
  const request = new Request("https://app.example.com/api/auth", {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      cookie: `${cookieNames.token}=expired-jwt; ${cookieNames.refreshToken}=valid-refresh-token`,
    },
    body: JSON.stringify({
      action: "auth/session:stop",
      args: {},
    }),
  });

  const response = await auth.proxy(request);
  expect(response.status).toBe(200);
  expect(signOutCalls).toBe(2);
});

function unsignedToken(payload: Record<string, unknown>) {
  const encode = (value: object) => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
}
