import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, expect, test, vi } from "vite-plus/test";

const ORIGINAL_ENV = {
  CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
  JWT_PRIVATE_KEY: process.env.JWT_PRIVATE_KEY,
};

afterEach(() => {
  vi.resetModules();
  process.env.CONVEX_SITE_URL = ORIGINAL_ENV.CONVEX_SITE_URL;
  process.env.JWT_PRIVATE_KEY = ORIGINAL_ENV.JWT_PRIVATE_KEY;
});

test("generateToken retries private-key import after an invalid warmup", async () => {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";
  process.env.JWT_PRIVATE_KEY = "not-a-valid-private-key";

  const tokens = await import("@robelest/convex-auth/server/tokens");
  await expect(
    tokens.generateToken({ userId: "user1" as any, sessionId: "session1" as any }, {} as any),
  ).rejects.toThrow();

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  process.env.JWT_PRIVATE_KEY = await exportPKCS8(keys.privateKey);

  await expect(
    tokens.generateToken({ userId: "user1" as any, sessionId: "session1" as any }, {} as any),
  ).resolves.toBeTypeOf("string");
});
