import {
  RandomReader,
  generateRandomString as osloGenerateRandomString,
} from "@oslojs/crypto/random";
import { sha256 as rawSha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

const utf8Encoder = new TextEncoder();

/**
 * Alphanumeric alphabet used to generate invite and connection tokens.
 * @internal
 */
export const INVITE_TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** @internal */
export async function sha256(input: string) {
  return encodeHexLowerCase(rawSha256(utf8Encoder.encode(input)));
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
