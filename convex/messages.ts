import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { query, mutation } from "./functions";
import { auth } from "./auth";

export const list = query({
  args: { groupId: v.optional(v.string()) },
  handler: async (ctx, { groupId }) => {
    const allMessages = await ctx.db.query("messages").order("desc").take(100);
    // Filter by groupId (undefined = general channel)
    const messages = allMessages.filter((m) =>
      groupId ? m.groupId === groupId : !m.groupId,
    );
    return Promise.all(
      messages.reverse().map(async (message) => {
        const { name, email, phone } =
          (await auth.user.get(ctx, message.userId))!;
        return { ...message, author: name ?? email ?? phone ?? "Anonymous" };
      }),
    );
  },
});

export const send = mutation({
  args: { body: v.string(), groupId: v.optional(v.string()) },
  handler: async (ctx, { body, groupId }) => {
    await ctx.db.insert("messages", {
      body,
      userId: ctx.auth.userId,
      ...(groupId ? { groupId } : {}),
    });
  },
});

/** Insert a message on behalf of a user (API key auth, no session). */
export const sendAsUser = internalMutation({
  args: { userId: v.string(), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, body }) => {
    await ctx.db.insert("messages", { body, userId });
    return null;
  },
});
