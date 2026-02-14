import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { auth } from "./auth";

/** Create an API key for the authenticated user. Returns the raw key once. */
export const createMyKey = mutation({
  args: { name: v.string() },
  returns: v.object({ keyId: v.string(), raw: v.string() }),
  handler: async (ctx, { name }) => {
    const userId = await auth.user.require(ctx);
    return await auth.key.create(ctx, {
      userId,
      name,
      scopes: [{ resource: "*", actions: ["*"] }],
    });
  },
});

/** List all API keys for the authenticated user. */
export const listMyKeys = query({
  args: {},
  handler: async (ctx) => {
    const userId = await auth.user.require(ctx);
    return await auth.key.list(ctx, { userId });
  },
});

/** Revoke one of the authenticated user's API keys. */
export const revokeMyKey = mutation({
  args: { keyId: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyId }) => {
    await auth.user.require(ctx);
    await auth.key.revoke(ctx, keyId);
    return null;
  },
});
