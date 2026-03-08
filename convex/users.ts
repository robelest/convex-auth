import { query } from "./functions";
import { emptyInput, nullableUnknownRecordOutput } from "./validation";

export const viewer = query
  .input(emptyInput)
  .returns(nullableUnknownRecordOutput)
  .handler(async (ctx) => {
    return ctx.auth.user;
  })
  .public();
