import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await auth.user.require(ctx);
    const messages = await ctx.db.query("messages").order("desc").take(100);
    return Promise.all(
      messages.reverse().map(async (message) => {
        const { name, email, phone } = (await auth.user.get(ctx, message.userId))!;
        return { ...message, author: name ?? email ?? phone ?? "Anonymous" };
      }),
    );
  },
});

export const send = mutation({
  args: { body: v.string() },
  handler: async (ctx, { body }) => {
    const userId = await auth.user.require(ctx);
    await ctx.db.insert("messages", { body, userId });
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
