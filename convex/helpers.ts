import { internalMutation } from "./functions";
import { resetInput } from "./validation";

// Deletes app-owned demo data.
// Auth tables live in the auth component and are not cleared here.
export const reset = internalMutation
  .input(resetInput)
  .handler(async (ctx) => {
    for (const { _id } of await ctx.db.query("messages").collect()) {
      await ctx.db.delete(_id);
    }
    return null;
  })
  .internal();
