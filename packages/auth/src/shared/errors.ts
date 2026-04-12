import { Data } from "effect";

export class AuthFlowError extends Data.TaggedError("AuthFlowError")<{
  readonly code: string;
  readonly message: string;
}> {}

/** @internal */
export const authFlowError = (code: string, message: string) =>
  new AuthFlowError({ code, message });
