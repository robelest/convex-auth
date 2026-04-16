import { ConvexError } from "convex/values";

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

function asCredentialsProvider(
  provider: AuthProviderMaterializedConfig,
): CredentialsProviderLike {
  if (provider.type !== "credentials") {
    throw credentialsError(
      "INVALID_CREDENTIALS_PROVIDER",
      `Provider ${provider.id} is not a credentials provider`,
    );
  }
  return provider;
}

/**
 * Hash a secret using the provider's `crypto.hashSecret` function.
 * @internal
 */
export async function hash(
  provider: AuthProviderMaterializedConfig,
  secret: string,
): Promise<string> {
  const credProvider = asCredentialsProvider(provider);
  const hashSecret = credProvider.crypto?.hashSecret;
  if (!hashSecret) {
    throw credentialsError(
      "MISSING_CRYPTO_FUNCTION",
      `Provider ${credProvider.id} does not have a \`crypto.hashSecret\` function`,
    );
  }
  try {
    return await hashSecret(secret);
  } catch (error) {
    throw credentialsError(
      "INTERNAL_ERROR",
      `Hash failed: ${errorMessage(error)}`,
    );
  }
}

/**
 * Verify a secret against a hash using the provider's `crypto.verifySecret` function.
 * @internal
 */
export async function verify(
  provider: AuthProviderMaterializedConfig,
  secret: string,
  hashValue: string,
): Promise<boolean> {
  const credProvider = asCredentialsProvider(provider);
  const verifySecret = credProvider.crypto?.verifySecret;
  if (!verifySecret) {
    throw credentialsError(
      "MISSING_CRYPTO_FUNCTION",
      `Provider ${credProvider.id} does not have a \`crypto.verifySecret\` function`,
    );
  }
  try {
    return await verifySecret(secret, hashValue);
  } catch (error) {
    throw credentialsError(
      "INTERNAL_ERROR",
      `Verify failed: ${errorMessage(error)}`,
    );
  }
}

export type GetProviderOrThrowFunc = (
  provider: string,
  allowExtraProviders?: boolean,
) => AuthProviderMaterializedConfig;

export type Config = ConvexAuthMaterializedConfig;
