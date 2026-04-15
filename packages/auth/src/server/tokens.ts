import { GenericId } from "convex/values";
import { SignJWT, importPKCS8 } from "jose";

import { requireEnv } from "./env";
import { generateRandomString } from "./random";
import { ConvexAuthConfig } from "./types";

export const TOKEN_SUB_CLAIM_DIVIDER = "|";

const DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60; // 1 hour
const TOKEN_JTI_LENGTH = 24;
const TOKEN_JTI_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let cachedPrivateKeyPromise: Promise<
  Awaited<ReturnType<typeof importPKCS8>>
> | null = null;
let cachedIssuer: string | null = null;

const getPrivateKey = () => {
  if (cachedPrivateKeyPromise === null) {
    cachedPrivateKeyPromise = importPKCS8(
      requireEnv("JWT_PRIVATE_KEY"),
      "RS256",
    );
  }
  return cachedPrivateKeyPromise;
};

const getIssuer = () => {
  if (cachedIssuer === null) {
    cachedIssuer = requireEnv("CONVEX_SITE_URL");
  }
  return cachedIssuer;
};

/** @internal */
export async function generateToken(
  args: {
    userId: GenericId<"User">;
    sessionId: GenericId<"Session">;
  },
  config: ConvexAuthConfig,
) {
  const privateKey = await getPrivateKey();
  const expirationTime = new Date(
    Date.now() + (config.jwt?.durationMs ?? DEFAULT_JWT_DURATION_MS),
  );
  return await new SignJWT({
    sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setJti(generateRandomString(TOKEN_JTI_LENGTH, TOKEN_JTI_ALPHABET))
    .setIssuer(getIssuer())
    .setAudience("convex")
    .setExpirationTime(expirationTime)
    .sign(privateKey);
}
