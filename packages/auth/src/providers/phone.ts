/**
 * Phone / SMS authentication provider.
 *
 * @module
 */

import { Fx } from "@robelest/fx";

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

      return await Fx.run(
        Fx.match(dispatch, dispatch.tag, {
          missingPhone: () =>
            Fx.fatal(
              new Error(
                "Token verification requires a `phone` in params of `signIn`.",
              ),
            ),
          mismatch: () =>
            Fx.fatal(
              new Error(
                "Short verification code requires a matching `phone` " +
                  "in params of `signIn`.",
              ),
            ),
          ok: () => Fx.succeed(undefined),
        }),
      );
    },
    sendVerificationRequest: config.send,
    options: {} as any,
  };
}
