import { GenericId } from "convex/values";
import { ConvexAuthConfig } from "../types";
import { SignJWT, importPKCS8 } from "jose";
import { requireEnv } from "../utils";
import { generateRandomString, TOKEN_SUB_CLAIM_DIVIDER } from "./utils";

const DEFAULT_JWT_DURATION_MS = 1000 * 60 * 60; // 1 hour
const TOKEN_JTI_LENGTH = 24;
const TOKEN_JTI_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export async function generateToken(
  args: {
    userId: GenericId<"user">;
    sessionId: GenericId<"session">;
  },
  config: ConvexAuthConfig,
) {
  const privateKey = await importPKCS8(requireEnv("JWT_PRIVATE_KEY"), "RS256");
  const expirationTime = new Date(
    Date.now() + (config.jwt?.durationMs ?? DEFAULT_JWT_DURATION_MS),
  );
  return await new SignJWT({
    sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setJti(generateRandomString(TOKEN_JTI_LENGTH, TOKEN_JTI_ALPHABET))
    .setIssuer(requireEnv("CONVEX_SITE_URL"))
    .setAudience("convex")
    .setExpirationTime(expirationTime)
    .sign(privateKey);
}
