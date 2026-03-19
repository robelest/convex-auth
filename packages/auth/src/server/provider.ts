import { Fx } from "@robelest/fx";

import { AuthError } from "./fx";
import { AuthProviderMaterializedConfig } from "./types";
import { ConvexAuthMaterializedConfig } from "./types";
import { errorMessage } from "./utils";

/**
 * Hash a secret using the provider's `crypto.hashSecret` function.
 *
 * Validates that the provider is a credentials provider and has the
 * required crypto function, returning typed errors through the Fx channel.
 */
export const hash = (provider: any, secret: string): Fx<string, AuthError> =>
  Fx.gen(function* () {
    if (provider.type !== "credentials") {
      return yield* Fx.fail(
        new AuthError(
          "INVALID_CREDENTIALS_PROVIDER",
          `Provider ${provider.id} is not a credentials provider`,
        ),
      );
    }

    const hashSecretFn = provider.crypto?.hashSecret as
      | ((s: string) => Promise<string>)
      | undefined;
    if (!hashSecretFn) {
      return yield* Fx.fail(
        new AuthError(
          "MISSING_CRYPTO_FUNCTION",
          `Provider ${provider.id} does not have a \`crypto.hashSecret\` function`,
        ),
      );
    }

    return yield* Fx.from({
      ok: () => hashSecretFn(secret),
      err: (e) =>
        new AuthError("INTERNAL_ERROR", `Hash failed: ${errorMessage(e)}`),
    });
  });

/**
 * Verify a secret against a hash using the provider's `crypto.verifySecret` function.
 */
export const verify = (
  provider: AuthProviderMaterializedConfig,
  secret: string,
  hashValue: string,
): Fx<boolean, AuthError> =>
  Fx.gen(function* () {
    if (provider.type !== "credentials") {
      return yield* Fx.fail(
        new AuthError(
          "INVALID_CREDENTIALS_PROVIDER",
          `Provider ${provider.id} is not a credentials provider`,
        ),
      );
    }

    const verifySecretFn = (provider as any).crypto?.verifySecret as
      | ((s: string, h: string) => Promise<boolean>)
      | undefined;
    if (!verifySecretFn) {
      return yield* Fx.fail(
        new AuthError(
          "MISSING_CRYPTO_FUNCTION",
          `Provider ${provider.id} does not have a \`crypto.verifySecret\` function`,
        ),
      );
    }

    return yield* Fx.from({
      ok: () => verifySecretFn(secret, hashValue),
      err: (e) =>
        new AuthError("INTERNAL_ERROR", `Verify failed: ${errorMessage(e)}`),
    });
  });

export type GetProviderOrThrowFunc = (
  provider: string,
  allowExtraProviders?: boolean,
) => AuthProviderMaterializedConfig;

export type Config = ConvexAuthMaterializedConfig;
