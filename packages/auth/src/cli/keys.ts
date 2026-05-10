import { randomBytes } from "node:crypto";

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

/**
 * Generate a fresh JWT signing keypair, JWKS payload, and secret-encryption key.
 *
 * Used by the Convex Auth setup wizard to provision required environment
 * variables on a target Convex deployment.
 *
 * @returns Generated `JWT_PRIVATE_KEY`, `JWKS`, and `AUTH_SECRET_ENCRYPTION_KEY` values.
 * @internal
 */
export async function generateKeys() {
  try {
    const keys = await generateKeyPair("EdDSA", {
      crv: "Ed25519",
      extractable: true,
    });
    const privateKey = await exportPKCS8(keys.privateKey);
    const publicKey = await exportJWK(keys.publicKey);
    const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });
    return {
      JWT_PRIVATE_KEY: privateKey.trimEnd(),
      JWKS: jwks,
      AUTH_SECRET_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    };
  } catch (error) {
    console.error(
      `Could not generate private and public key, are you running this command using Node.js?\n ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
