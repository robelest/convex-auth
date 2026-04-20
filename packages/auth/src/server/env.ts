import { ConvexError } from "convex/values";

function readEnv(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function missingEnvMessage(name: string) {
  switch (name) {
    case "JWT_PRIVATE_KEY":
    case "JWKS":
    case "AUTH_SECRET_ENCRYPTION_KEY":
      return `Missing environment variable \`${name}\`. Run the convex-auth setup wizard to generate and configure auth keys.`;
    default:
      return `Missing environment variable \`${name}\``;
  }
}

/** @internal */
export const readConfigSync = <A>(value: A) => value;

/** @internal */
export const envString = (name: string) => {
  const value = readEnv(name);
  if (value === undefined) {
    throw new Error(missingEnvMessage(name));
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
      message: missingEnvMessage(name),
    });
  }
}
