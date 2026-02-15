import { throwAuthError } from "./errors";

export function requireEnv(name: string) {
  const value = process.env[name];
  if (value === undefined) {
    throwAuthError("MISSING_ENV_VAR", `Missing environment variable \`${name}\``, { variable: name });
  }
  return value;
}

export function isLocalHost(host?: string) {
  return /(localhost|127\.0\.0\.1):\d+/.test(
  host ?? "");
}