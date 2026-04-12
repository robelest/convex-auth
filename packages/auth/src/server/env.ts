import { ConvexError } from "convex/values";

function readEnv(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** @internal */
export const readConfigSync = <A>(value: A) => value;

/** @internal */
export const envString = (name: string) => {
  const value = readEnv(name);
  if (value === undefined) {
    throw new Error(`Missing environment variable \`${name}\``);
  }
  return value;
};

/** @internal */
export const envOptionalString = (name: string) => readEnv(name);

/** @internal */
export const envOptionalNumber = (name: string) => {
  const value = readEnv(name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable \`${name}\``);
  }
  return parsed;
};

/** @internal */
export const envBoolean = (name: string) => {
  const value = readEnv(name);
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Invalid boolean environment variable \`${name}\``);
};

/** @internal */
export function requireEnv(name: string) {
  try {
    return readConfigSync(envString(name));
  } catch {
    throw new ConvexError({
      code: "MISSING_ENV_VAR",
      message: `Missing environment variable \`${name}\``,
    });
  }
}
