import { ConvexError } from "convex/values";

import { ErrorCode } from "../shared/codes";
import { AuthFlowError } from "../shared/errors";

export type AuthErrorData = {
  code: string;
  message: string;
};

/**
 * Build a `ConvexError` carrying an auth error `code` and `message`, plus any
 * extra structured fields.
 * @internal
 */
export const convexError = (
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): ConvexError<AuthErrorData> => new ConvexError({ code, message, ...extra });

/** @internal */
export const toConvexError = (error: unknown): ConvexError<AuthErrorData> => {
  if (error instanceof ConvexError) {
    return error as ConvexError<AuthErrorData>;
  }
  if (error instanceof AuthFlowError) {
    return new ConvexError({ code: error.code, message: error.message });
  }
  return new ConvexError({
    code: ErrorCode.INTERNAL_ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
};
