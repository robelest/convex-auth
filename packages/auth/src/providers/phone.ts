/**
 * Phone / SMS authentication provider.
 *
 * @module
 */

import { Fx } from "@robelest/fx";

import type { PhoneConfig } from "../server/types";

export interface PhoneProviderConfig {
  /** Send the verification code to the user's phone. */
  send: PhoneConfig["sendVerificationRequest"];
  /** Provider ID override. Defaults to "phone". */
  id?: string;
  /** Token expiration in seconds. Defaults to 1200 (20 minutes). */
  maxAge?: number;
}

export class Phone {
  readonly id: string;
  readonly type = "phone" as const;

  constructor(public readonly config: PhoneProviderConfig) {
    this.id = config.id ?? "phone";
  }

  /** @internal */
  _toMaterialized(): PhoneConfig {
    return {
      id: this.id,
      type: "phone",
      maxAge: this.config.maxAge ?? 60 * 20,
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
      sendVerificationRequest: this.config.send,
      options: {} as any,
    };
  }
}
