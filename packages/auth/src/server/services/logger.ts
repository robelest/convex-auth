import { LOG_LEVELS, logMessage } from "../../shared/log";

type AuthLoggerService = {
  readonly log: (level: keyof typeof LOG_LEVELS, ...args: unknown[]) => void;
};

export const createAuthLogger = (): AuthLoggerService => ({
  log: (level, ...args) => logMessage("convex-auth", level, args),
});
