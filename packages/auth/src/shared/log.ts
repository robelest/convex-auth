import { Cause, Effect, Match } from "effect";

export const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
} as const;

export type LogLevel = keyof typeof LOG_LEVELS;

function serialize(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logMessage(
  module: string,
  level: LogLevel,
  args: readonly unknown[],
  configuredLogLevel: LogLevel = "INFO",
) {
  const message = args.map(serialize).join(" ");

  return Match.value(level).pipe(
    Match.when("ERROR", () =>
      Effect.runSync(
        Effect.logError(message).pipe(
          Effect.annotateLogs({ module, level }),
        ),
      ),
    ),
    Match.when("WARN", () => {
      if (configuredLogLevel === "ERROR") {
        return;
      }
      return Effect.runSync(
        Effect.logWarning(message).pipe(
          Effect.annotateLogs({ module, level }),
        ),
      );
    }),
    Match.when("INFO", () => {
      if (configuredLogLevel !== "INFO" && configuredLogLevel !== "DEBUG") {
        return;
      }
      return Effect.runSync(
        Effect.logInfo(message).pipe(
          Effect.annotateLogs({ module, level }),
        ),
      );
    }),
    Match.when("DEBUG", () => {
      if (configuredLogLevel !== "DEBUG") {
        return;
      }
      return Effect.runSync(
        Effect.logDebug(message).pipe(
          Effect.annotateLogs({ module, level }),
        ),
      );
    }),
    Match.exhaustive,
  );
}

export function logErrorCause(module: string, message: string, cause: Cause.Cause<unknown>) {
  return Effect.runSync(
    Effect.logError(`${message} ${serialize(Cause.squash(cause))}`).pipe(
      Effect.annotateLogs({ module, level: LOG_LEVELS.ERROR }),
    ),
  );
}
