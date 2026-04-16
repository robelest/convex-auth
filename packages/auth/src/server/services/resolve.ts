import { configDefaults } from "../config";
import type { ConvexAuthConfig } from "../types";
import { createAuthConfig } from "./config";
import { createAuthLogger } from "./logger";
import { createProviderRegistry } from "./providers";
import { createAuthRefresh } from "./refresh";
import { createAuthSignIn } from "./signin";

export function resolveServerServices(config: ConvexAuthConfig) {
  const configValue = configDefaults(config);
  const logger = createAuthLogger();
  const authConfig = createAuthConfig(config);
  const providerRegistry = createProviderRegistry(configValue, logger);
  const signIn = createAuthSignIn(configValue);
  const refresh = createAuthRefresh(configValue);

  return {
    config: authConfig.config,
    logger,
    providerRegistry,
    signIn,
    refresh,
  };
}

export type ServerServices = ReturnType<typeof resolveServerServices>;
