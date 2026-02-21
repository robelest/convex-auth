import { ConvexHttpClient } from "convex/browser";
import { afterEach, expect, test, vi } from "vitest";
import {
  createOAuthAuthorizationURL,
  handleOAuthCallback,
} from "../../auth/src/server/oauth";
import { parseAuthError } from "../../auth/src/server/errors";
import { authCookieNames, server } from "../../auth/src/server/index";
import { isLocalHost } from "../../auth/src/server/utils";

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

  const localhostCookieNames = authCookieNames("localhost");
  expect(localhostCookieNames.token.startsWith("__Host-")).toBe(false);
});

test("OAuth callback rejects PKCE provider when verifier cookie is missing", async () => {
  const provider = {
    createAuthorizationURL(_state: string, _codeVerifier: string, _scopes: string[]) {
      return new URL("https://accounts.example.com/oauth");
    },
    validateAuthorizationCode: vi.fn(),
  };

  const authResult = await createOAuthAuthorizationURL(
    "google",
    provider,
    {},
  );
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

test("refresh keeps existing session cookies when code exchange fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ConvexHttpClient.prototype, "action").mockRejectedValue(
    new Error("exchange failed"),
  );

  const auth = server({ url: "https://example.convex.cloud" });
  const host = "app.example.com";
  const cookieNames = authCookieNames(host);
  const request = new Request("https://app.example.com/?code=abc", {
    method: "GET",
    headers: {
      host,
      accept: "text/html",
      cookie: `${cookieNames.token}=jwt-token; ${cookieNames.refreshToken}=refresh-token; ${cookieNames.verifier}=verifier-token`,
    },
  });

  const result = await auth.refresh(request);

  expect(result.redirect).toBe("https://app.example.com/");
  expect(result.token).toBe("jwt-token");

  const tokenCookie = result.cookies.find((cookie) => cookie.name === cookieNames.token);
  const refreshCookie = result.cookies.find(
    (cookie) => cookie.name === cookieNames.refreshToken,
  );
  const verifierCookie = result.cookies.find(
    (cookie) => cookie.name === cookieNames.verifier,
  );

  expect(tokenCookie?.value).toBe("jwt-token");
  expect(refreshCookie?.value).toBe("refresh-token");
  expect(verifierCookie?.value).toBe("");
});

test("refresh does not mutate cookies for CORS requests", async () => {
  const auth = server({ url: "https://example.convex.cloud" });
  const host = "app.example.com";
  const cookieNames = authCookieNames(host);
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

test("proxy signIn errors keep existing cookies for non-refresh requests", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(ConvexHttpClient.prototype, "action").mockRejectedValue(
    new Error("signIn failed"),
  );

  const auth = server({
    url: "https://example.convex.cloud",
    apiRoute: "/api/auth",
  });
  const host = "app.example.com";
  const cookieNames = authCookieNames(host);
  const request = new Request("https://app.example.com/api/auth", {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      cookie: `${cookieNames.token}=jwt-token; ${cookieNames.refreshToken}=refresh-token; ${cookieNames.verifier}=verifier-token`,
    },
    body: JSON.stringify({
      action: "auth:signIn",
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
