import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
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
    tokens.generateToken(
      { identity: { subject: "user1" as any, sessionId: "session1" as any } },
      {} as any,
    ),
  ).rejects.toThrow();

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  process.env.JWT_PRIVATE_KEY = await exportPKCS8(keys.privateKey);

  const token = await tokens.generateToken(
    {
      identity: {
        subject: "user1" as any,
        sessionId: "session1" as any,
        email: "user@example.com",
        emailVerified: true,
        name: "Test User",
        picture: "https://example.com/avatar.png",
      },
    },
    {} as any,
  );

  expect(token).toBeTypeOf("string");

  const claims = decodeJwt(token);
  expect(claims.sub).toBe("user1");
  expect(claims.sid).toBe("session1");
  expect(claims.email).toBe("user@example.com");
  expect(claims.email_verified).toBe(true);
  expect(claims.name).toBe("Test User");
  expect(claims.picture).toBe("https://example.com/avatar.png");
});

test("generateToken accepts flattened PKCS#8 private keys", async () => {
  process.env.CONVEX_SITE_URL = "http://127.0.0.1:3211";

  const keys = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const pem = await exportPKCS8(keys.privateKey);
  process.env.JWT_PRIVATE_KEY = pem.trimEnd().replace(/\n/g, " ");

  const tokens = await import("@robelest/convex-auth/server/tokens");
  const token = await tokens.generateToken(
    { identity: { subject: "user2" as any, sessionId: "session2" as any } },
    {} as any,
  );

  const claims = decodeJwt(token);
  expect(claims.sub).toBe("user2");
  expect(claims.sid).toBe("session2");
});
