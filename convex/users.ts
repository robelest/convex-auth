import { query } from "./functions";

export const viewer = query({
  args: {},
  handler: async (ctx) => ctx.auth.user,
});
