/**
 * Email (magic link / OTP) authentication provider.
 *
 * @module
 */

import { defaultMagicLinkEmail } from "../server/templates";
import type { EmailConfig } from "../server/types";

export interface EmailProviderConfig {
  /** Sender address (e.g. "My App <noreply@example.com>"). */
  from: string;
  /** Send the verification email. Receives the Convex action context. */
  send: (
    ctx: any,
    opts: { from: string; to: string; subject: string; html: string },
  ) => Promise<void>;
  /** Override to generate a custom verification token. */
  generateVerificationToken?: () => Promise<string>;
  /** Provider ID override. Defaults to "email". */
  id?: string;
  /** Token expiration in seconds. Defaults to 86400 (24 hours). */
  maxAge?: number;
}

export class Email {
  readonly id: string;
  readonly type = "email" as const;

  constructor(public readonly config: EmailProviderConfig) {
    const from = config.from.trim();
    if (from.length === 0) {
      throw new Error(
        "Email provider requires a non-empty `from` address " +
          '(for example, `"My App <noreply@example.com>"`).',
      );
    }
    this.id = config.id ?? "email";
  }

  /** @internal */
  _toMaterialized(): EmailConfig {
    const from = this.config.from.trim();
    const { send } = this.config;
    const { generateVerificationToken } = this.config;
    return {
      id: this.id,
      type: "email",
      name: "Email",
      from,
      maxAge: this.config.maxAge ?? 60 * 60 * 24,
      authorize: undefined,
      sendVerificationRequest: async ({ identifier, url }, ctx) => {
        if (!ctx) {
          throw new Error("Email provider requires a Convex action context.");
        }
        const { host } = new URL(url);
        await send(ctx, {
          from,
          to: identifier,
          subject: `Sign in to ${host}`,
          html: defaultMagicLinkEmail(url, host),
        });
      },
      generateVerificationToken,
      options: { from } as any,
    };
  }
}
