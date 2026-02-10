import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
// Deletes app-owned demo data.
// Auth tables live in the auth component and are not cleared here.
export const reset = internalMutation({
  args: { forReal: v.string() },
  handler: async (ctx, args) => {
    if (args.forReal !== "I know what I'm doing") {
      throw new Error("You must know what you're doing to reset the database.");
    }
    for (const { _id } of await ctx.db.query("messages").collect()) {
      await ctx.db.delete(_id);
    }
  },
});
