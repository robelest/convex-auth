import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { components } from "./_generated/api";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    return userId !== null
      ? await ctx.runQuery(components.auth.public.userGetById, { userId })
      : null;
  },
});
