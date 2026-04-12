import {
  RandomReader,
  generateRandomString as osloGenerateRandomString,
} from "@oslojs/crypto/random";
import { sha256 as rawSha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";

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
