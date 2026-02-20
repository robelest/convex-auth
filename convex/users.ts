import { query } from "./functions";
import { emptyInput } from "./validation";

export const viewer = query
  .input(emptyInput)
  .handler(async (ctx) => {
    return ctx.auth.user;
  })
  .public();
