import {
  RandomReader,
  generateRandomString as osloGenerateRandomString,
} from "@oslojs/crypto/random";
import { sha256 as rawSha256 } from "@oslojs/crypto/sha2";
import {
  decodeBase64urlIgnorePadding,
  encodeBase64urlNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";

import { AuthError } from "./fx";

/**
 * Require an environment variable to be set, throwing at config time if missing.
 *
 * Uses `AuthError.toConvexError()` directly since this is a synchronous guard
 * called inline in many expressions — not suitable for Fx pipeline wrapping.
 */
/** @internal */
export function requireEnv(name: string) {
  const value = process.env[name];
  if (value === undefined) {
    throw new AuthError(
      "MISSING_ENV_VAR",
      `Missing environment variable \`${name}\``,
      { variable: name },
    ).toConvexError();
  }
  return value;
}

/** @internal */
export function isLocalHost(host?: string) {
  if (host === undefined) {
    return false;
  }
  const raw = host.includes("://") ? host : `http://${host}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  );
}

// Internal server utilities (merged from former internalUtils.ts)

/** @internal */
export const TOKEN_SUB_CLAIM_DIVIDER = "|";
/** @internal */
export const REFRESH_TOKEN_DIVIDER = "|";

/** @internal */
export async function sha256(input: string) {
  return encodeHexLowerCase(rawSha256(new TextEncoder().encode(input)));
}

/** @internal */
export function generateRandomString(length: number, alphabet: string) {
  const random: RandomReader = {
    read(bytes) {
      crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    },
  };

  return osloGenerateRandomString(random, alphabet, length);
}

/** @internal */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** @internal */
export function logError(error: unknown) {
  logWithLevel(
    LOG_LEVELS.ERROR,
    error instanceof Error
      ? error.message + "\n" + error.stack?.replace("\\n", "\n")
      : error,
  );
}

/** @internal */
export const LOG_LEVELS = {
  ERROR: "ERROR",
  WARN: "WARN",
  INFO: "INFO",
  DEBUG: "DEBUG",
} as const;
type LogLevel = keyof typeof LOG_LEVELS;

/** @internal */
export function logWithLevel(level: LogLevel, ...args: unknown[]) {
  const configuredLogLevel =
    LOG_LEVELS[
      (process.env.AUTH_LOG_LEVEL as LogLevel | undefined) ?? "INFO"
    ] ?? "INFO";
  switch (level) {
    case "ERROR":
      console.error(...args);
      break;
    case "WARN":
      if (configuredLogLevel !== "ERROR") {
        console.warn(...args);
      }
      break;
    case "INFO":
      if (configuredLogLevel === "INFO" || configuredLogLevel === "DEBUG") {
        console.info(...args);
      }
      break;
    case "DEBUG":
      if (configuredLogLevel === "DEBUG") {
        console.debug(...args);
      }
      break;
  }
}

const UNREDACTED_LENGTH = 5;
/** @internal */
export function maybeRedact(value: string) {
  if (value === "") {
    return "";
  }
  const shouldRedact = process.env.AUTH_LOG_SECRETS !== "true";
  if (shouldRedact) {
    if (value.length < UNREDACTED_LENGTH * 2) {
      return "<redacted>";
    }
    return (
      value.substring(0, UNREDACTED_LENGTH) +
      "<redacted>" +
      value.substring(value.length - UNREDACTED_LENGTH)
    );
  } else {
    return value;
  }
}

const SECRET_KEY_ENV = "AUTH_SECRET_ENCRYPTION_KEY";
const SECRET_IV_LENGTH = 12;

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

async function getSecretCryptoKey() {
  const material = requireEnv(SECRET_KEY_ENV);
  const rawKey = rawSha256(new TextEncoder().encode(material));
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/** @internal */
export async function encryptSecret(value: string) {
  const key = await getSecretCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(SECRET_IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(new TextEncoder().encode(value)),
  );
  return `${encodeBase64urlNoPadding(iv)}.${encodeBase64urlNoPadding(new Uint8Array(encrypted))}`;
}

/** @internal */
export async function decryptSecret(ciphertext: string) {
  const [ivEncoded, payloadEncoded] = ciphertext.split(".");
  if (!ivEncoded || !payloadEncoded) {
    throw new AuthError(
      "INVALID_PARAMETERS",
      "Stored enterprise secret is malformed.",
    ).toConvexError();
  }
  const key = await getSecretCryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(decodeBase64urlIgnorePadding(ivEncoded)),
    },
    key,
    toArrayBuffer(decodeBase64urlIgnorePadding(payloadEncoded)),
  );
  return new TextDecoder().decode(decrypted);
}
