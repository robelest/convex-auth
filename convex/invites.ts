import { ConvexError } from "convex/values";
import { auth } from "./auth";
import { authMutation } from "./functions";
import { acceptInviteInput, createInviteInput } from "./validation";

export const createLink = authMutation
  .input(createInviteInput)
  .handler(async (ctx, args) => {
    const membership = await auth.user.group.get(ctx, {
      userId: ctx.auth.userId,
      groupId: args.groupId,
    });
    if (membership === null) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You must be a group member to create invite links",
      });
    }

    const expiresTime =
      args.expiresInHours === undefined
        ? undefined
        : Date.now() + args.expiresInHours * 60 * 60 * 1000;

    const { inviteId, token } = await auth.invite.create(ctx, {
      groupId: args.groupId,
      invitedByUserId: ctx.auth.userId,
      email: args.email,
      role: args.role ?? "member",
      expiresTime,
    });

    return {
      inviteId,
      token,
      expiresTime: expiresTime ?? null,
      invitePath: `/chat?invite=${encodeURIComponent(token)}`,
    };
  })
  .public();

export const acceptToken = authMutation
  .input(acceptInviteInput)
  .handler(async (ctx, { token }) => {
    const result = await auth.invite.acceptByToken(ctx, {
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
