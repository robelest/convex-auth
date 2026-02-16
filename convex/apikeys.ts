import { v } from "convex/values";
import { query, mutation } from "./functions";
import { auth } from "./auth";

/** Create an API key for the authenticated user. Returns the raw key once. */
export const createMyKey = mutation({
  args: { name: v.string() },
  returns: v.object({ keyId: v.string(), raw: v.string() }),
  handler: async (ctx, { name }) => {
    return await auth.key.create(ctx, {
      userId: ctx.auth.userId,
      name,
      scopes: [{ resource: "*", actions: ["*"] }],
    });
  },
});

/** List all API keys for the authenticated user. */
export const listMyKeys = query({
  args: {},
  handler: async (ctx) => {
    const { items } = await auth.key.list(ctx, { where: { userId: ctx.auth.userId } });
    return items;
  },
});

/** Revoke one of the authenticated user's API keys. */
export const revokeMyKey = mutation({
  args: { keyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    await auth.key.revoke(ctx, keyId);
    return null;
  },
});
