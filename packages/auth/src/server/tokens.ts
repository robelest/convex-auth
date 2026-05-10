import { SignJWT, importPKCS8 } from "jose";

import { envOptionalString, readConfigSync, requireEnv } from "./env";
import { generateRandomString } from "./random";
import { ConvexAuthConfig } from "./types";
import type { SessionTokenIdentityClaims } from "./types";
import { withSpan } from "./utils/span";

const DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60; // 1 hour
const TOKEN_JTI_LENGTH = 24;
const TOKEN_JTI_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let cachedPrivateKeyPromise: Promise<Awaited<ReturnType<typeof importPKCS8>>> | null = null;
let cachedIssuer: string | null = null;

const JWT_ALG = "EdDSA" as const;

function normalizePkcs8Pem(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("-----BEGIN PRIVATE KEY-----")) {
    return trimmed;
  }

  const withEscapedNewlines = trimmed.replace(/\\n/g, "\n");
  if (withEscapedNewlines.includes("\n")) {
    return withEscapedNewlines;
  }

  const beginMarker = "-----BEGIN PRIVATE KEY-----";
  const endMarker = "-----END PRIVATE KEY-----";
  const body = trimmed.replace(beginMarker, "").replace(endMarker, "").trim().replace(/\s+/g, "");

  if (body.length === 0) {
    return trimmed;
  }

  const wrappedBody = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${beginMarker}\n${wrappedBody}\n${endMarker}`;
}

const getPrivateKey = () => {
  if (cachedPrivateKeyPromise === null) {
    try {
      const pem = normalizePkcs8Pem(requireEnv("JWT_PRIVATE_KEY"));
      cachedPrivateKeyPromise = importPKCS8(pem, JWT_ALG).catch((error) => {
        cachedPrivateKeyPromise = null;
        throw error;
      });
    } catch (error) {
      cachedPrivateKeyPromise = null;
      throw error;
    }
  }
  return cachedPrivateKeyPromise;
};

const getIssuer = () => {
  if (cachedIssuer === null) {
    cachedIssuer = appendAuthPrefix(
      requireEnv("CONVEX_SITE_URL"),
      readConfigSync(envOptionalString("CONVEX_AUTH_HTTP_PREFIX")) ?? "/auth",
    );
  }
  return cachedIssuer;
};

function appendAuthPrefix(siteUrl: string, prefix: string) {
  const normalizedSiteUrl = siteUrl.replace(/\/$/, "");
  const normalizedPrefix = normalizeAuthPrefix(prefix);
  return `${normalizedSiteUrl}${normalizedPrefix}`;
}

function normalizeAuthPrefix(prefix: string) {
  const trimmed = prefix.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

try {
  void getPrivateKey().catch(() => {});
} catch {}
try {
  getIssuer();
} catch {}

/** @internal */
export async function generateToken(
  args: {
    identity: SessionTokenIdentityClaims;
  },
  config: ConvexAuthConfig,
) {
  const privateKey = await withSpan("convex-auth.tokens.import-key", { alg: JWT_ALG }, () =>
    getPrivateKey(),
  );
  const expirationTime = new Date(Date.now() + (config.jwt?.durationMs ?? DEFAULT_JWT_DURATION_MS));
  const claims = {
    sub: args.identity.subject,
    sid: args.identity.sessionId,
    ...(args.identity.name !== undefined ? { name: args.identity.name } : null),
    ...(args.identity.email !== undefined ? { email: args.identity.email } : null),
    ...(args.identity.emailVerified !== undefined
      ? { email_verified: args.identity.emailVerified }
      : null),
    ...(args.identity.picture !== undefined ? { picture: args.identity.picture } : null),
    ...(args.identity.phoneNumber !== undefined
      ? { phone_number: args.identity.phoneNumber }
      : null),
    ...(args.identity.phoneNumberVerified !== undefined
      ? { phone_number_verified: args.identity.phoneNumberVerified }
      : null),
  };
  return await withSpan("convex-auth.tokens.sign", { alg: JWT_ALG }, () =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: JWT_ALG })
      .setIssuedAt()
      .setJti(generateRandomString(TOKEN_JTI_LENGTH, TOKEN_JTI_ALPHABET))
      .setIssuer(getIssuer())
      .setAudience("convex")
      .setExpirationTime(expirationTime)
      .sign(privateKey),
  );
}
