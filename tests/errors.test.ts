import { ConvexError } from "convex/values";
import { expect, test } from "vite-plus/test";

test("auth errors are plain ConvexError with { code, message }", () => {
  const error = new ConvexError({
    code: "NOT_SIGNED_IN",
    message: "You must be signed in.",
  });
  expect(error).toBeInstanceOf(ConvexError);
  expect(error.data.code).toBe("NOT_SIGNED_IN");
  expect(error.data.message).toBe("You must be signed in.");
});
