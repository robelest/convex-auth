import type { GenericId } from "convex/values";
import { Layer, ServiceMap } from "effect";

import { configDefaults } from "../config";
import type { SignInParams } from "../payloads";
import { signInImpl } from "../signin";
import type {
  AuthDataModel,
  AuthProviderMaterializedConfig,
  GenericActionCtxWithAuthConfig,
} from "../types";

export class AuthSignInService extends ServiceMap.Service<
  AuthSignInService,
  {
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
  }
>()("AuthSignInService") {}

export const AuthSignInLive = (_config: ReturnType<typeof configDefaults>) =>
  Layer.succeed(AuthSignInService)({
    signIn: (ctx, provider, args, options) =>
      signInImpl(ctx, provider, args, options),
  });
