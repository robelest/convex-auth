/**
 * Email (magic link / OTP) authentication provider.
 *
 * @module
 */

import { defaultMagicLinkEmail } from "../server/templates";
import type { EmailConfig } from "../server/types";

/**
 * User-facing configuration for the {@link Email} provider.
 *
 * Use this to wire your email delivery service into Convex Auth's magic-link
 * or OTP flow.
 */
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

/**
 * Email provider for magic-link or one-time-code sign-in.
 *
 * Sends verification emails through your `send()` implementation and converts
 * the result into Convex Auth's internal email-provider runtime shape.
 *
 * @example
 * ```ts
 * import { Email } from "@robelest/convex-auth/providers";
 *
 * const email = new Email({
 *   from: "My App <noreply@example.com>",
 *   send: async (_ctx, { to, subject, html }) => {
 *     await resend.emails.send({ from: "noreply@example.com", to, subject, html });
 *   },
 * });
 * ```
 */
export class Email {
  readonly id: string;
  readonly type = "email" as const;

  /**
   * Create an email provider instance.
   *
   * @param config - Email transport and provider settings.
   * @throws {Error} When `config.from` is empty or whitespace-only.
   */
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
