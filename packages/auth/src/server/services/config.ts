import { Layer, ServiceMap } from "effect";

import { configDefaults } from "../config";
import type { ConvexAuthConfig } from "../types";

export class AuthConfigService extends ServiceMap.Service<
  AuthConfigService,
  { readonly config: ReturnType<typeof configDefaults> }
>()("AuthConfigService") {}

export const AuthConfigLive = (config_: ConvexAuthConfig) => {
  const config = configDefaults(config_);
  return Layer.succeed(AuthConfigService)({ config });
};
