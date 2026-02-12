import { PasskeyProviderConfig } from "../server/types.js";

/**
 * Passkey (WebAuthn) authentication provider.
 *
 * Enables passwordless authentication via biometrics, security keys,
 * and synced passkeys using the Web Authentication API.
 *
 * ```ts
 * import passkey from "@robelest/convex-auth/providers/passkey";
 *
 * export const { auth, signIn, signOut, store } = Auth({
 *   component: components.auth,
 *   providers: [passkey()],
 * });
 * ```
 *
 * @param config Optional configuration for the relying party and credential options.
 */
export default function passkey(
  config?: Partial<PasskeyProviderConfig["options"]>,
): PasskeyProviderConfig {
  return {
    id: "passkey",
    type: "passkey",
    options: {
      attestation: "none",
      userVerification: "required",
      residentKey: "preferred",
      algorithms: [-7, -257], // ES256, RS256
      challengeExpirationMs: 300_000, // 5 minutes
      ...config,
    },
  };
}
