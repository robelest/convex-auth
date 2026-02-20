import { ConvexError } from "convex/values";
import { auth } from "./auth";
import { mutation, query } from "./functions";
import { createKeyInput, emptyInput, revokeKeyInput } from "./validation";

/** Create an API key for the authenticated user. Returns the raw key once. */
export const createMyKey = mutation
  .input(createKeyInput)
  .handler(async (ctx, { name }) => {
    return await auth.key.create(ctx, {
      userId: ctx.auth.userId,
      name,
      scopes: [{ resource: "*", actions: ["*"] }],
    });
  })
  .public();

/** List all API keys for the authenticated user. */
export const listMyKeys = query
  .input(emptyInput)
  .handler(async (ctx) => {
    const { items } = await auth.key.list(ctx, {
      where: { userId: ctx.auth.userId },
    });
    return items;
  })
  .public();

/** Revoke one of the authenticated user's API keys. */
export const revokeMyKey = mutation
  .input(revokeKeyInput)
  .handler(async (ctx, { keyId }) => {
    const key = await auth.key.get(ctx, keyId);
    if (key === null || key.userId !== ctx.auth.userId) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "You cannot revoke a key you do not own",
      });
    }
    await auth.key.revoke(ctx, keyId);
    return null;
  })
  .public();
