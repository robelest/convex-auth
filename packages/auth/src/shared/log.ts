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

export function logErrorCause(
  module: string,
  message: string,
  cause: unknown,
) {
  const causeMessage = cause instanceof Error
    ? `${cause.message}${cause.stack ? `\n${cause.stack}` : ""}`
    : serialize(cause);
  console.error(`[${module}] [${LOG_LEVELS.ERROR}]`, `${message} ${causeMessage}`);
}
