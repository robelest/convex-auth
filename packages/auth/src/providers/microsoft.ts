/**
 * Microsoft OAuth provider.
 *
 * ```ts
 * import { microsoft } from "@robelest/convex-auth/providers/microsoft";
 *
 * microsoft({
 *   tenant: process.env.AUTH_MICROSOFT_TENANT_ID!,
 *   clientId: process.env.AUTH_MICROSOFT_ID!,
 *   clientSecret: process.env.AUTH_MICROSOFT_SECRET!,
 * })
 * ```
 *
 * @module
 */

import { MicrosoftEntraId } from "arctic";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import { createOAuthProvider } from "../server/oauthProvider";

const DEFAULT_SCOPES = ["openid", "profile", "email"];

/** Configuration for the {@link microsoft} provider. */
export interface MicrosoftConfig {
  tenant: string;
  clientId: string;
  clientSecret?: string | null;
  redirectUri?: string;
  scopes?: string[];
  accountLinking?: "verifiedEmail" | "none";
}

/**
 * Create a Microsoft OAuth provider.
 *
 * This wrapper enables nonce handling and validates the returned ID token.
 *
 * @param config - Microsoft Entra ID client settings.
 * @returns A configured Microsoft OAuth provider for `createAuth`.
 * @throws {Error} When no callback URL can be derived and `redirectUri` is omitted.
 *
 * @example
 * ```ts
 * import { microsoft } from "@robelest/convex-auth/providers/microsoft";
 *
 * microsoft({
 *   tenant: process.env.AUTH_MICROSOFT_TENANT_ID!,
 *   clientId: process.env.AUTH_MICROSOFT_ID!,
 *   clientSecret: process.env.AUTH_MICROSOFT_SECRET!,
 * })
 * ```
 */
export function microsoft(config: MicrosoftConfig) {
  const provider = new MicrosoftEntraId(
    config.tenant,
    config.clientId,
    config.clientSecret ?? null,
    config.redirectUri ?? defaultRedirectUri("microsoft"),
  );
  const issuer = `https://login.microsoftonline.com/${config.tenant}/v2.0`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/discovery/v2.0/keys`));

  return createOAuthProvider({
    id: "microsoft",
    provider,
    scopes: config.scopes ?? DEFAULT_SCOPES,
    nonce: true,
    accountLinking: config.accountLinking,
    validateTokens: async (tokens, ctx) => {
      if (!ctx.nonce) {
        throw new Error("Microsoft OAuth requires a nonce.");
      }
      if (!tokens.idToken) {
        throw new Error("Microsoft OAuth response is missing id_token.");
      }

      const idToken = tokens.idToken;
      const protectedHeader = decodeProtectedHeader(idToken);
      const tokenAlg = protectedHeader.alg;
      const usesSymmetricAlg =
        tokenAlg === "HS256" || tokenAlg === "HS384" || tokenAlg === "HS512";

      const verification = await (usesSymmetricAlg
        ? jwtVerify(
            idToken,
            (() => {
              if (!config.clientSecret) {
                throw new Error(
                  "Microsoft token uses symmetric signatures but clientSecret is missing.",
                );
              }
              return new TextEncoder().encode(config.clientSecret);
            })(),
            {
              issuer,
              audience: config.clientId,
              requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
              clockTolerance: 10,
            },
          )
        : jwtVerify(idToken, jwks, {
            issuer,
            audience: config.clientId,
            requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
            clockTolerance: 10,
          }));

      if (verification.payload.nonce !== ctx.nonce) {
        throw new Error("Microsoft OAuth nonce mismatch.");
      }

      if (
        Array.isArray(verification.payload.aud) &&
        verification.payload.aud.length > 1 &&
        verification.payload.azp !== config.clientId
      ) {
        throw new Error(
          "Microsoft OAuth authorized party does not match client ID.",
        );
      }
    },
  });
}

function defaultRedirectUri(providerId: string) {
  const rootUrl =
    process.env.CUSTOM_AUTH_SITE_URL ?? process.env.CONVEX_SITE_URL;
  if (!rootUrl) {
    throw new Error(
      `Missing CONVEX_SITE_URL while configuring ${providerId} OAuth provider. ` +
        "Set CONVEX_SITE_URL or pass redirectUri explicitly.",
    );
  }
  return `${rootUrl}/api/auth/callback/${providerId}`;
}
