import { ConvexError } from "convex/values";
import { Effect, Match, Option, pipe } from "effect";

import type {
  AuthProviderMaterializedConfig,
  ConvexAuthMaterializedConfig,
} from "./types";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type AuthError = ConvexError<{ code: string; message: string }>;

const credentialsError = (code: string, message: string): AuthError =>
  new ConvexError({ code, message });

type CredentialsProviderLike = Extract<
  AuthProviderMaterializedConfig,
  { type: "credentials" }
>;

const asCredentialsProvider = (
  provider: AuthProviderMaterializedConfig,
): Effect.Effect<CredentialsProviderLike, AuthError> =>
  Match.value(provider).pipe(
    Match.when({ type: "credentials" }, (provider) => Effect.succeed(provider)),
    Match.orElse((provider) =>
      Effect.fail(
        credentialsError(
          "INVALID_CREDENTIALS_PROVIDER",
          `Provider ${provider.id} is not a credentials provider`,
        ),
      ),
    ),
  );

/**
 * Hash a secret using the provider's `crypto.hashSecret` function.
 */
/** @internal */
export const hash = (
  provider: AuthProviderMaterializedConfig,
  secret: string,
): Effect.Effect<string, AuthError> =>
  Effect.flatMap(asCredentialsProvider(provider), (provider) =>
    pipe(
      Option.fromNullishOr(provider.crypto?.hashSecret),
      Option.match({
        onNone: () =>
          Effect.fail(
            credentialsError(
              "MISSING_CRYPTO_FUNCTION",
              `Provider ${provider.id} does not have a \`crypto.hashSecret\` function`,
            ),
          ),
        onSome: (hashSecret) =>
          Effect.tryPromise({
            try: () => hashSecret(secret),
            catch: (error) =>
              credentialsError(
                "INTERNAL_ERROR",
                `Hash failed: ${errorMessage(error)}`,
              ),
          }),
      }),
    ),
  );

/**
 * Verify a secret against a hash using the provider's `crypto.verifySecret` function.
 */
/** @internal */
export const verify = (
  provider: AuthProviderMaterializedConfig,
  secret: string,
  hashValue: string,
): Effect.Effect<boolean, AuthError> =>
  Effect.flatMap(asCredentialsProvider(provider), (provider) =>
    pipe(
      Option.fromNullishOr(provider.crypto?.verifySecret),
      Option.match({
        onNone: () =>
          Effect.fail(
            credentialsError(
              "MISSING_CRYPTO_FUNCTION",
              `Provider ${provider.id} does not have a \`crypto.verifySecret\` function`,
            ),
          ),
        onSome: (verifySecret) =>
          Effect.tryPromise({
            try: () => verifySecret(secret, hashValue),
            catch: (error) =>
              credentialsError(
                "INTERNAL_ERROR",
                `Verify failed: ${errorMessage(error)}`,
              ),
          }),
      }),
    ),
  );

export type GetProviderOrThrowFunc = (
  provider: string,
  allowExtraProviders?: boolean,
) => AuthProviderMaterializedConfig;

export type Config = ConvexAuthMaterializedConfig;
