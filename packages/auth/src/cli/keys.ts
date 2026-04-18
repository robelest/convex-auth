import { randomBytes } from "node:crypto";

import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

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
      JWT_PRIVATE_KEY: `${privateKey.trimEnd().replace(/\n/g, " ")}`,
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
