import { randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { api } from "@convex/_generated/api";
import { ConvexHttpClient } from "convex/browser";

export interface SimpleResponse {
  ok: boolean;
  status: number;
  headers: Headers & { getSetCookie: () => string[] };
  text: () => Promise<string>;
}

export interface ConvexSessionStartResult {
  kind: string;
  tokens?: { token: string; refreshToken: string } | null;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required test env: ${name}`);
  return value;
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function resolveHostname(hostname: string): string {
  if (hostname === "host.docker.internal") {
    return "127.0.0.1";
  }
  return hostname;
}

export function randomSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function toHeadersObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }
  return result;
}

export function requestHttp(
  input: string,
  init: RequestOptions = {},
): Promise<SimpleResponse> {
  const url = new URL(input);
  const request = url.protocol === "https:" ? https.request : http.request;
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  const body = init.body;

  if (!headers.has("host")) {
    headers.set("host", url.host);
  }

  if (body !== undefined && !headers.has("content-length")) {
    headers.set("content-length", String(Buffer.byteLength(body)));
  }

  return new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: url.protocol,
        hostname: resolveHostname(url.hostname),
        port: url.port
          ? Number(url.port)
          : url.protocol === "https:"
            ? 443
            : 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers: toHeadersObject(headers),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const normalizedHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers)) {
            if (key === "set-cookie") {
              continue;
            }
            if (Array.isArray(value)) {
              normalizedHeaders.set(key, value.join(", "));
              continue;
            }
            if (typeof value === "string") {
              normalizedHeaders.set(key, value);
            }
          }

          const setCookieHeader = response.headers["set-cookie"];
          const setCookies =
            setCookieHeader === undefined
              ? []
              : Array.isArray(setCookieHeader)
                ? setCookieHeader
                : [setCookieHeader];

          const headersWithSetCookie = Object.assign(normalizedHeaders, {
            getSetCookie: () => setCookies,
          }) as Headers & { getSetCookie: () => string[] };

          resolve({
            ok:
              (response.statusCode ?? 0) >= 200 &&
              (response.statusCode ?? 0) <= 299,
            status: response.statusCode ?? 0,
            headers: headersWithSetCookie,
            text: async () => text,
          });
        });
      },
    );

    req.on("error", reject);

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

export async function requestJson<T>(
  url: string,
  opts: RequestOptions = {},
): Promise<T> {
  const response = await requestHttp(url, opts);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${opts.method ?? "GET"} ${url} failed: ${response.status} ${text}`,
    );
  }
  if (text === "") {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

async function enterpriseRpc<T>(
  convexClient: ConvexHttpClient,
  userToken: string,
  functionPath: string[],
  args: Record<string, unknown>,
): Promise<T> {
  convexClient.setAuth(userToken);
  let reference: any = api as any;
  for (const segment of functionPath) {
    reference = reference?.[segment];
  }
  if (!reference) {
    throw new Error(
      `Enterprise RPC function not found: ${functionPath.join(".")}`,
    );
  }
  return (await convexClient.action(reference, args)) as T;
}

export async function enterpriseConnectionCreateRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    groupId?: string;
    name?: string;
    slug?: string;
    status?: "draft" | "active" | "disabled";
    domain?: string;
  },
): Promise<{ enterpriseId: string; groupId: string }> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "connection", "create"],
    args as any,
  );
}

export async function enterpriseOidcConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    enterpriseId: string;
    issuer?: string;
    discoveryUrl?: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string[];
    authorizationParams?: Record<string, string>;
    clockToleranceSeconds?: number;
    strictIssuer?: boolean;
  },
): Promise<Record<string, unknown>> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "oidc", "configure"],
    args as any,
  );
}

export async function enterpriseSamlConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    enterpriseId: string;
    metadataXml?: string;
    metadataUrl?: string;
    domains?: string[];
    signAuthnRequests?: boolean;
    attributeMapping?: {
      subject?: string;
      email?: string;
      name?: string;
      firstName?: string;
      lastName?: string;
    };
  },
): Promise<Record<string, unknown>> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "saml", "configure"],
    args as any,
  );
}

export async function enterpriseScimConfigureRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    enterpriseId: string;
    basePath?: string;
    deprovisionMode?: "soft" | "hard";
    status?: "draft" | "active" | "disabled";
  },
): Promise<{ token?: string; configId?: string }> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "scim", "configure"],
    args as any,
  );
}

export async function enterpriseWebhookEndpointCreateRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: {
    enterpriseId: string;
    url: string;
    secret: string;
    subscriptions: string[];
  },
): Promise<Record<string, unknown>> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "webhook", "endpoint", "create"],
    args as any,
  );
}

export async function enterpriseWebhookDeliveryListRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: { enterpriseId: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "webhook", "delivery", "list"],
    args as any,
  );
}

export async function enterpriseAuditListRpc(
  convexClient: ConvexHttpClient,
  userToken: string,
  args: { enterpriseId: string; limit?: number },
): Promise<Array<Record<string, unknown>>> {
  return await enterpriseRpc(
    convexClient,
    userToken,
    ["enterprise", "audit", "list"],
    args as any,
  );
}
