import { ConvexError } from "convex/values";

import type { MutationCtx, QueryCtx } from "./_generated/server";
import { auth } from "./auth";
import { internalMutation, mutation, query } from "./functions";
import {
  nullOutput,
  listMessagesInput,
  messageInput,
  sendAsUserInput,
  unknownRecordListOutput,
} from "./validation";

type AuthMessageContext = (QueryCtx | MutationCtx) & {
  auth: {
    userId: string;
  };
};

async function assertGroupMembership(ctx: AuthMessageContext, groupId: string) {
  const membership = await auth.user.group.get(ctx, {
    userId: ctx.auth.userId,
    groupId,
  });
  if (membership === null) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You must be a member of this group",
    });
  }
}

export const list = query
  .input(listMessagesInput)
  .returns(unknownRecordListOutput)
  .handler(async (ctx, { groupId }) => {
    if (groupId) {
      await assertGroupMembership(ctx, groupId);
    }

    const allMessages = await ctx.db.query("messages").order("desc").take(100);
    const messages = allMessages.filter((message) =>
      groupId ? message.groupId === groupId : !message.groupId,
    );

    return await Promise.all(
      messages.reverse().map(async (message) => {
        const user = await auth.user.get(ctx, message.userId);
        return {
          ...message,
          author: user?.name ?? user?.email ?? user?.phone ?? "Anonymous",
        };
      }),
    );
  })
  .public();

export const send = mutation
  .input(messageInput)
  .returns(nullOutput)
  .handler(async (ctx, { body, groupId }) => {
    if (groupId) {
      await assertGroupMembership(ctx, groupId);
    }

    await ctx.db.insert("messages", {
      body,
      userId: ctx.auth.userId,
      ...(groupId ? { groupId } : {}),
    });
    return null;
  })
  .public();

/** Insert a message on behalf of a user (API key auth, no session). */
export const sendAsUser = internalMutation
  .input(sendAsUserInput)
  .returns(nullOutput)
  .handler(async (ctx, { userId, body }) => {
    await ctx.db.insert("messages", { body, userId });
    return null;
  })
  .internal();
