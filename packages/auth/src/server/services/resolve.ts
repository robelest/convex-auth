import { configDefaults } from "../config";
import type { ConvexAuthConfig } from "../types";
import { createAuthLogger } from "./logger";
import { createProviderRegistry } from "./providers";
import { createAuthRefresh } from "./refresh";
import { createAuthSignIn } from "./signin";

export function resolveServerServices(config: ConvexAuthConfig) {
  const configValue = configDefaults(config);
  const logger = createAuthLogger();
  const providerRegistry = createProviderRegistry(configValue, logger);
  const signIn = createAuthSignIn(configValue);
  const refresh = createAuthRefresh(configValue);

  return {
    config: configValue,
    logger,
    providerRegistry,
    signIn,
    refresh,
  };
}

export type ServerServices = ReturnType<typeof resolveServerServices>;
