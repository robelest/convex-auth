import { AuthProviderMaterializedConfig } from "../types";
import { ConvexAuthMaterializedConfig } from "../types";
import { throwAuthError } from "../errors";

export async function hash(provider: any, secret: string) {
  if (provider.type !== "credentials") {
    throwAuthError("INVALID_CREDENTIALS_PROVIDER", `Provider ${provider.id} is not a credentials provider`, { provider: provider.id });
  }
  const hashSecretFn = provider.crypto?.hashSecret;
  if (hashSecretFn === undefined) {
    throwAuthError("MISSING_CRYPTO_FUNCTION", `Provider ${provider.id} does not have a \`crypto.hashSecret\` function`, { provider: provider.id });
  }
  return await hashSecretFn(secret);
}

export async function verify(
  provider: AuthProviderMaterializedConfig,
  secret: string,
  hash: string,
) {
  if (provider.type !== "credentials") {
    throwAuthError("INVALID_CREDENTIALS_PROVIDER", `Provider ${provider.id} is not a credentials provider`, { provider: provider.id });
  }
  const verifySecretFn = provider.crypto?.verifySecret;
  if (verifySecretFn === undefined) {
    throwAuthError("MISSING_CRYPTO_FUNCTION", `Provider ${provider.id} does not have a \`crypto.verifySecret\` function`, { provider: provider.id });
  }
  return await verifySecretFn(secret, hash);
}

export type GetProviderOrThrowFunc = (
  provider: string,
  allowExtraProviders?: boolean,
) => AuthProviderMaterializedConfig;

export type Config = ConvexAuthMaterializedConfig;
