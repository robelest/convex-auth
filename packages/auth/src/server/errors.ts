import { ConvexError } from "convex/values";

import { AuthFlowError } from "../shared/errors";

export type AuthErrorData = {
  code: string;
  message: string;
};

/**
 * Internal signal carrying a non-`signedIn` flow result up through a
 * credentials authorize callback.
 *
 * `ctx.auth.provider.signIn` re-enters the canonical sign-in flow so a
 * credentials provider (e.g. password.ts) can hand off to a verify/reset
 * email provider, an OAuth redirect, or a device-code flow. Those handlers
 * resolve to results like `{ kind: "started" }` or `{ kind: "redirect" }`,
 * which the credentials runner has no shape to return — its `authorize`
 * contract is `{ userId, ... } | null`. Throwing a `FlowSignal` lets the
 * runner unwrap it and forward the carried result unchanged to the outer
 * signIn action.
 *
 * @internal
 */
export class FlowSignal<T extends { kind: string }> extends Error {
  readonly result: T;
  constructor(result: T) {
    super(`FlowSignal:${result.kind}`);
    this.name = "FlowSignal";
    this.result = result;
  }
}

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
