/**
 * Leveled console logging shared across auth internals.
 *
 * @module
 */

/** Supported log severities, ordered from most to least severe. */
export const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
} as const;

/** One of the {@link LOG_LEVELS} severity names. */
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

/**
 * Format and emit a log line, suppressing anything below `configuredLogLevel`.
 *
 * @param module - Source module label included in the prefix.
 * @param level - Severity of this message.
 * @param args - Values to serialize and join into the message body.
 * @param configuredLogLevel - Minimum level to emit. Defaults to `"INFO"`.
 */
export function logMessage(
  module: string,
  level: LogLevel,
  args: readonly unknown[],
  configuredLogLevel: LogLevel = "INFO",
) {
  const message = args.map(serialize).join(" ");
  const meta = { module, level };

  const levelHandlers: Record<LogLevel, () => void> = {
    ERROR: () => {
      console.error(`[${meta.module}] [${meta.level}]`, message);
    },
    WARN: () => {
      if (configuredLogLevel === "ERROR") {
        return;
      }
      console.warn(`[${meta.module}] [${meta.level}]`, message);
    },
    INFO: () => {
      if (configuredLogLevel !== "INFO" && configuredLogLevel !== "DEBUG") {
        return;
      }
      console.info(`[${meta.module}] [${meta.level}]`, message);
    },
    DEBUG: () => {
      if (configuredLogLevel !== "DEBUG") {
        return;
      }
      console.debug(`[${meta.module}] [${meta.level}]`, message);
    },
  };

  const handler = levelHandlers[level];
  if (handler) {
    handler();
  }
}
