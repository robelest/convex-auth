/**
 * Phone / SMS authentication provider.
 *
 * @module
 */

import { Effect, Match } from "effect";

import type { PhoneConfig } from "../server/types";

/** Configuration for the {@link phone} provider. */
export interface PhoneProviderConfig {
  send: PhoneConfig["sendVerificationRequest"];
  id?: string;
  maxAge?: number;
}

/**
 * Create a phone or SMS verification provider.
 *
 * @param config - SMS delivery hook and optional provider settings.
 * @returns A configured phone provider for `createAuth`.
 *
 * @example
 * ```ts
 * import { phone } from "@robelest/convex-auth/providers";
 *
 * phone({
 *   send: async ({ identifier, token }) => {
 *     await sendSms(identifier, `Your sign-in code is ${token}`);
 *   },
 * })
 * ```
 */
export function phone(config: PhoneProviderConfig): PhoneConfig {
  return {
    id: config.id ?? "phone",
    type: "phone",
    maxAge: config.maxAge ?? 60 * 20,
    authorize: async (params, account) => {
      const dispatch =
        typeof params.phone !== "string"
          ? ({ tag: "missingPhone" } as const)
          : account.providerAccountId !== params.phone
            ? ({ tag: "mismatch" } as const)
            : ({ tag: "ok" } as const);

      return await Effect.runPromise(
        Match.value(dispatch).pipe(
          Match.when({ tag: "missingPhone" }, () =>
            Effect.die(
              new Error(
                "Token verification requires a `phone` in params of `signIn`.",
              ),
            ),
          ),
          Match.when({ tag: "mismatch" }, () =>
            Effect.die(
              new Error(
                "Short verification code requires a matching `phone` " +
                  "in params of `signIn`.",
              ),
            ),
          ),
          Match.when({ tag: "ok" }, () => Effect.succeed(undefined)),
          Match.exhaustive,
        ),
      );
    },
    sendVerificationRequest: config.send,
    options: {},
  };
}
