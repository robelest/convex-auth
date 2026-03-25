/// <reference types="vite-plus/client" />

import resendTest from "@convex-dev/resend/test";
import authTest from "@robelest/convex-auth/test";
import { convexTest as baseConvexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

if (!process.env.SITE_URL) {
  process.env.SITE_URL = "http://localhost:5173";
}

if (!process.env.APP_URL) {
  process.env.APP_URL = process.env.SITE_URL;
}

if (!process.env.CONVEX_SITE_URL) {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
}

if (!process.env.AUTH_EMAIL) {
  process.env.AUTH_EMAIL = "test@example.com";
}

if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = "test-resend-api-key";
}

if (!process.env.GOOGLE_CLIENT_ID) {
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
}

if (!process.env.GOOGLE_CLIENT_SECRET) {
  process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
}

if (!process.env.AUTH_SECRET_ENCRYPTION_KEY) {
  process.env.AUTH_SECRET_ENCRYPTION_KEY = "test-auth-secret-encryption-key";
}

if (!process.env.JWT_PRIVATE_KEY || !process.env.JWKS) {
  const keys = await generateKeyPair("RS256", { extractable: true });
  process.env.JWT_PRIVATE_KEY = await exportPKCS8(keys.privateKey);
  const publicKey = await exportJWK(keys.publicKey);
  process.env.JWKS = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
}

export * from "convex-test";

export const convexTest = ((
  schema: Parameters<typeof baseConvexTest>[0],
  modules = import.meta.glob("../convex/**/*.*s"),
) => {
  const t = baseConvexTest(schema as never, modules as never);
  authTest.register(t as any, "auth");
  resendTest.register(t as any, "resend");
  return t;
}) as typeof baseConvexTest;
