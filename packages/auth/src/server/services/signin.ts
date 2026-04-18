import type { GenericId } from "convex/values";

import { configDefaults } from "../config";
import type { SignInParams } from "../payloads";
import { signInImpl } from "../signin";
import type {
  AuthDataModel,
  AuthProviderMaterializedConfig,
  GenericActionCtxWithAuthConfig,
} from "../types";

export type AuthSignInService = {
  readonly signIn: (
    ctx: GenericActionCtxWithAuthConfig<AuthDataModel>,
    provider: AuthProviderMaterializedConfig | null,
    args: {
      accountId?: GenericId<"Account">;
      params?: SignInParams;
      verifier?: string;
      refreshToken?: string;
      calledBy?: string;
    },
    options: {
      generateTokens: boolean;
      allowExtraProviders: boolean;
      resolveSsoProtocol?: (
        ctx: GenericActionCtxWithAuthConfig<AuthDataModel>,
        connectionId: string,
      ) => Promise<"oidc" | "saml">;
    },
  ) => Promise<Awaited<ReturnType<typeof signInImpl>>>;
};

export const createAuthSignIn = (
  _config: ReturnType<typeof configDefaults>,
): AuthSignInService => ({
  signIn: (ctx, provider, args, options) => signInImpl(ctx, provider, args, options),
});
