import { Layer, ServiceMap } from "effect";

import { LOG_LEVELS, logMessage } from "../../shared/log";

export class AuthLoggerService extends ServiceMap.Service<
  AuthLoggerService,
  { readonly log: (level: keyof typeof LOG_LEVELS, ...args: unknown[]) => void }
>()("AuthLoggerService") {}

export const AuthLoggerLive = Layer.succeed(AuthLoggerService)({
  log: (level, ...args) => logMessage("convex-auth", level, args),
});
