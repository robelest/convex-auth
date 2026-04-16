import { configDefaults } from "../config";
import type { ConvexAuthConfig } from "../types";

export type AuthConfigService = {
  readonly config: ReturnType<typeof configDefaults>;
};

export const createAuthConfig = (config_: ConvexAuthConfig): AuthConfigService => {
  const config = configDefaults(config_);
  return { config };
};
