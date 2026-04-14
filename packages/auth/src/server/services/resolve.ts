import { Effect, Layer, ServiceMap } from "effect";

import { configDefaults } from "../config";
import type { ConvexAuthConfig } from "../types";
import { AuthConfigService } from "./config";
import { AuthLoggerLive, AuthLoggerService } from "./logger";
import { ProviderRegistryLive, ProviderRegistryService } from "./providers";
import { AuthRefreshLive, AuthRefreshService } from "./refresh";
import { AuthSignInLive, AuthSignInService } from "./signin";

export function resolveServerServices(config: ConvexAuthConfig) {
  const configValue = configDefaults(config);
  const loggerValue = Effect.runSync(
    Effect.map(Effect.scoped(Layer.build(AuthLoggerLive)), (context) =>
      ServiceMap.getUnsafe(context, AuthLoggerService),
    ),
  );
  const layer = Layer.mergeAll(
    Layer.succeed(AuthLoggerService)(loggerValue),
    Layer.succeed(AuthConfigService)({ config: configValue }),
    ProviderRegistryLive(configValue, loggerValue),
    AuthSignInLive(configValue),
    AuthRefreshLive(configValue),
  );
  const context = Effect.runSync(Effect.scoped(Layer.build(layer)));
  return {
    config: ServiceMap.getUnsafe(context, AuthConfigService).config,
    logger: ServiceMap.getUnsafe(context, AuthLoggerService),
    providerRegistry: ServiceMap.getUnsafe(context, ProviderRegistryService),
    signIn: ServiceMap.getUnsafe(context, AuthSignInService),
    refresh: ServiceMap.getUnsafe(context, AuthRefreshService),
  };
}

export type ServerServices = ReturnType<typeof resolveServerServices>;
