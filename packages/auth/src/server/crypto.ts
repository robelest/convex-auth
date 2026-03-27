import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import { ConvexError } from "convex/values";

import { AuthProviderMaterializedConfig } from "./types";
import { ConvexAuthMaterializedConfig } from "./types";
import { errorMessage } from "./utils";

/**
 * Hash a secret using the provider's `crypto.hashSecret` function.
 *
 * Validates that the provider is a credentials provider and has the
 * required crypto function, returning typed errors through the Fx channel.
 */
/** @internal */
export const hash = (
  provider: any,
  secret: string,
): Fx<string, ConvexError<any>> =>
  Fx.gen(function* () {
    if (provider.type !== "credentials") {
      return yield* Cv.fail({
        code: "INVALID_CREDENTIALS_PROVIDER",
        message: `Provider ${provider.id} is not a credentials provider`,
      });
    }

    const hashSecretFn = provider.crypto?.hashSecret as
      | ((s: string) => Promise<string>)
      | undefined;
    if (!hashSecretFn) {
      return yield* Cv.fail({
        code: "MISSING_CRYPTO_FUNCTION",
        message: `Provider ${provider.id} does not have a \`crypto.hashSecret\` function`,
      });
    }

    return yield* Fx.from({
      ok: () => hashSecretFn(secret),
      err: (e) =>
        Cv.error({
          code: "INTERNAL_ERROR",
          message: `Hash failed: ${errorMessage(e)}`,
        }),
    });
  });

/**
 * Verify a secret against a hash using the provider's `crypto.verifySecret` function.
 */
/** @internal */
export const verify = (
  provider: AuthProviderMaterializedConfig,
  secret: string,
  hashValue: string,
): Fx<boolean, ConvexError<any>> =>
  Fx.gen(function* () {
    if (provider.type !== "credentials") {
      return yield* Cv.fail({
        code: "INVALID_CREDENTIALS_PROVIDER",
        message: `Provider ${provider.id} is not a credentials provider`,
      });
    }

    const verifySecretFn = (provider as any).crypto?.verifySecret as
      | ((s: string, h: string) => Promise<boolean>)
      | undefined;
    if (!verifySecretFn) {
      return yield* Cv.fail({
        code: "MISSING_CRYPTO_FUNCTION",
        message: `Provider ${provider.id} does not have a \`crypto.verifySecret\` function`,
      });
    }

    return yield* Fx.from({
      ok: () => verifySecretFn(secret, hashValue),
      err: (e) =>
        Cv.error({
          code: "INTERNAL_ERROR",
          message: `Verify failed: ${errorMessage(e)}`,
        }),
    });
  });

export type GetProviderOrThrowFunc = (
  provider: string,
  allowExtraProviders?: boolean,
) => AuthProviderMaterializedConfig;

export type Config = ConvexAuthMaterializedConfig;
