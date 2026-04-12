import { LOG_LEVELS, type LogLevel, logMessage } from "../shared/log";
import { envBoolean, envOptionalString, readConfigSync } from "./env";

export { LOG_LEVELS };
export type { LogLevel };

const configuredLogLevel =
  LOG_LEVELS[(readConfigSync(envOptionalString("AUTH_LOG_LEVEL")) as LogLevel | undefined) ?? "INFO"] ??
  "INFO";

const shouldRedactSecrets = !readConfigSync(
  envBoolean("AUTH_LOG_SECRETS") ?? false,
);

/** @internal */
export function log(level: LogLevel, ...args: unknown[]) {
  return logMessage("convex-auth", level, args, configuredLogLevel);
}

/** @internal */
export function logError(error: unknown) {
  return log(
    LOG_LEVELS.ERROR,
    error instanceof Error
      ? error.message + "\n" + error.stack?.replace("\\n", "\n")
      : error,
  );
}

const UNREDACTED_LENGTH = 5;

/** @internal */
export function maybeRedact(value: string) {
  if (value === "") {
    return "";
  }
  if (shouldRedactSecrets) {
    if (value.length < UNREDACTED_LENGTH * 2) {
      return "<redacted>";
    }
    return (
      value.substring(0, UNREDACTED_LENGTH) +
      "<redacted>" +
      value.substring(value.length - UNREDACTED_LENGTH)
    );
  }
  return value;
}
