/**
 * Email (magic link / OTP) authentication provider.
 *
 * @module
 */

import { defaultMagicLinkEmail } from "../server/templates";
import type { GenericActionCtx, GenericDataModel } from "convex/server";

import type { EmailConfig } from "../server/types";

/** Configuration for the {@link email} provider. */
export interface EmailProviderConfig {
  from: string;
  send: (
    ctx: GenericActionCtx<GenericDataModel>,
    opts: { from: string; to: string; subject: string; html: string },
  ) => Promise<void>;
  generateVerificationToken?: () => Promise<string>;
  id?: string;
  maxAge?: number;
}

/**
 * Create an email magic link or OTP provider.
 *
 * @param config - Sender identity and delivery hooks for verification emails.
 * @returns A configured email provider for `createAuth`.
 * @throws {Error} When `from` is empty.
 *
 * @example
 * ```ts
 * import { email } from "@robelest/convex-auth/providers";
 *
 * email({
 *   from: "My App <noreply@example.com>",
 *   send: async (_ctx, message) => {
 *     await resend.emails.send(message);
 *   },
 * })
 * ```
 */
export function email(config: EmailProviderConfig): EmailConfig {
  const from = config.from.trim();
  if (from.length === 0) {
    throw new Error(
      "Email provider requires a non-empty `from` address " +
        '(for example, `"My App <noreply@example.com>"`).',
    );
  }
  const { send } = config;
  const { generateVerificationToken } = config;
  return {
    id: config.id ?? "email",
    type: "email",
    name: "Email",
    from,
    maxAge: config.maxAge ?? 60 * 60 * 24,
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
    options: { from },
  };
}
