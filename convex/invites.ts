import { Resend } from "@convex-dev/resend";
import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import { auth } from "./auth";
import { authMutation } from "./functions";
import { acceptInviteInput, createInviteInput } from "./validation";

const resend = new Resend(components.resend, { testMode: false });
const DEFAULT_FROM = process.env.AUTH_EMAIL ?? "My App <onboarding@resend.dev>";

export const sendEmail = authMutation
  .input(createInviteInput)
  .handler(async (ctx, args) => {
    const membership = await auth.user.group.get(ctx, {
      userId: ctx.auth.userId,
      groupId: args.groupId,
    });
    if (membership === null) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You must be a group member to send invites",
      });
    }

    const normalizedEmail = args.email.trim().toLowerCase();
    const expiresTime =
      args.expiresInHours === undefined
        ? undefined
        : Date.now() + args.expiresInHours * 60 * 60 * 1000;

    const { inviteId, token } = await auth.invite.create(ctx, {
      groupId: args.groupId,
      invitedByUserId: ctx.auth.userId,
      email: normalizedEmail,
      role: args.role ?? "member",
      expiresTime,
    });

    const group = await auth.group.get(ctx, args.groupId);
    const inviterLabel =
      ctx.auth.user.name ??
      ctx.auth.user.email ??
      ctx.auth.user.phone ??
      "A teammate";
    const groupLabel = group?.name ?? "your channel";
    const invitePath = `/chat?invite=${encodeURIComponent(token)}`;
    const inviteUrl = `${appUrl()}${invitePath}`;

    try {
      await resend.sendEmail(ctx, {
        from: DEFAULT_FROM,
        to: normalizedEmail,
        subject: `${inviterLabel} invited you to #${groupLabel}`,
        html: inviteEmailHtml({
          inviterLabel,
          groupLabel,
          inviteUrl,
          expiresTime,
        }),
        text: inviteEmailText({
          inviterLabel,
          groupLabel,
          inviteUrl,
          expiresTime,
        }),
      });
    } catch (error) {
      try {
        await auth.invite.revoke(ctx, inviteId);
      } catch {
        // Best effort cleanup.
      }
      throw new ConvexError({
        code: "INVITE_EMAIL_SEND_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Could not send invite email",
      });
    }

    return {
      inviteId,
      email: normalizedEmail,
      expiresTime: expiresTime ?? null,
    };
  })
  .public();

export const acceptToken = authMutation
  .input(acceptInviteInput)
  .handler(async (ctx, { token }) => {
    const result = await auth.invite.token.accept(ctx, {
      token,
      acceptedByUserId: ctx.auth.userId,
    });

    return {
      inviteId: result.inviteId,
      groupId: result.groupId,
      memberId: result.memberId ?? null,
      inviteStatus: result.inviteStatus,
      membershipStatus: result.membershipStatus,
    };
  })
  .public();

function appUrl() {
  const base = process.env.SITE_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return base.replace(/\/$/, "");
}

function inviteEmailHtml(args: {
  inviterLabel: string;
  groupLabel: string;
  inviteUrl: string;
  expiresTime?: number;
}) {
  const inviterLabel = escapeHtml(args.inviterLabel);
  const groupLabel = escapeHtml(args.groupLabel);
  const inviteUrl = escapeHtml(args.inviteUrl);
  const expires =
    args.expiresTime === undefined
      ? "This invite does not expire."
      : `This invite expires on ${new Date(args.expiresTime).toUTCString()}.`;

  return [
    `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">`,
    `<p>${inviterLabel} invited you to join <strong>#${groupLabel}</strong>.</p>`,
    `<p>To accept, sign in with this email address and continue:</p>`,
    `<p><a href="${inviteUrl}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Accept Invite</a></p>`,
    `<p style="font-size:12px;color:#555">${escapeHtml(expires)}</p>`,
    `<p style="font-size:12px;color:#555">If the button does not work, paste this URL into your browser:<br/>${inviteUrl}</p>`,
    `</div>`,
  ].join("");
}

function inviteEmailText(args: {
  inviterLabel: string;
  groupLabel: string;
  inviteUrl: string;
  expiresTime?: number;
}) {
  const expires =
    args.expiresTime === undefined
      ? "This invite does not expire."
      : `This invite expires on ${new Date(args.expiresTime).toUTCString()}.`;
  return [
    `${args.inviterLabel} invited you to join #${args.groupLabel}.`,
    "",
    "To accept, sign in with this email address and open this link:",
    args.inviteUrl,
    "",
    expires,
  ].join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
