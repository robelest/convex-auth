import { throwAuthError } from "./errors";

export function requireEnv(name: string) {
  const value = process.env[name];
  if (value === undefined) {
    throwAuthError("MISSING_ENV_VAR", `Missing environment variable \`${name}\``, { variable: name });
  }
  return value;
}

export function isLocalHost(host?: string) {
  if (host === undefined) {
    return false;
  }
  try {
    const url = host.includes("://") ? new URL(host) : new URL(`http://${host}`);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1"
    );
  } catch {
    return false;
  }
}
