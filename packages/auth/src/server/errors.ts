import { ConvexError } from "convex/values";

import { AuthFlowError } from "../shared/errors";

export type AuthErrorData = {
  code: string;
  message: string;
};

/** @internal */
export const toConvexError = (error: unknown): ConvexError<AuthErrorData> => {
  if (error instanceof ConvexError) {
    return error as ConvexError<AuthErrorData>;
  }
  if (error instanceof AuthFlowError) {
    return new ConvexError({ code: error.code, message: error.message });
  }
  return new ConvexError({
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
  });
};
