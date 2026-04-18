import { GenericId } from "convex/values";
import { SignJWT, importPKCS8 } from "jose";

import { requireEnv } from "./env";
import { generateRandomString } from "./random";
import { ConvexAuthConfig } from "./types";
import { withSpan } from "./utils/span";

export const TOKEN_SUB_CLAIM_DIVIDER = "|";

const DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60; // 1 hour
const TOKEN_JTI_LENGTH = 24;
const TOKEN_JTI_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let cachedPrivateKeyPromise: Promise<Awaited<ReturnType<typeof importPKCS8>>> | null = null;
let cachedIssuer: string | null = null;

const JWT_ALG = "EdDSA" as const;

const getPrivateKey = () => {
  if (cachedPrivateKeyPromise === null) {
    try {
      cachedPrivateKeyPromise = importPKCS8(requireEnv("JWT_PRIVATE_KEY"), JWT_ALG).catch(
        (error) => {
          cachedPrivateKeyPromise = null;
          throw error;
        },
      );
    } catch (error) {
      cachedPrivateKeyPromise = null;
      throw error;
    }
  }
  return cachedPrivateKeyPromise;
};

const getIssuer = () => {
  if (cachedIssuer === null) {
    cachedIssuer = requireEnv("CONVEX_SITE_URL");
  }
  return cachedIssuer;
};

try {
  void getPrivateKey().catch(() => {});
} catch {}
try {
  getIssuer();
} catch {}

/** @internal */
export async function generateToken(
  args: {
    userId: GenericId<"User">;
    sessionId: GenericId<"Session">;
  },
  config: ConvexAuthConfig,
) {
  const privateKey = await withSpan("convex-auth.tokens.import-key", { alg: JWT_ALG }, () =>
    getPrivateKey(),
  );
  const expirationTime = new Date(Date.now() + (config.jwt?.durationMs ?? DEFAULT_JWT_DURATION_MS));
  return await withSpan("convex-auth.tokens.sign", { alg: JWT_ALG }, () =>
    new SignJWT({
      sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId,
    })
      .setProtectedHeader({ alg: JWT_ALG })
      .setIssuedAt()
      .setJti(generateRandomString(TOKEN_JTI_LENGTH, TOKEN_JTI_ALPHABET))
      .setIssuer(getIssuer())
      .setAudience("convex")
      .setExpirationTime(expirationTime)
      .sign(privateKey),
  );
}
