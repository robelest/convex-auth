import { Cv } from "@robelest/fx/convex";
import type { ConvexError } from "convex/values";

import { AUTH_ERRORS } from "./errors";
import type { AuthErrorCode } from "./errors";

/**
 * Typed error for the Fx error channel.
 *
 * Use with `Fx.fail(new AuthError("CODE"))` in pipelines.
 * At Convex boundaries, {@link toConvexError} converts these to `ConvexError`.
 */
export class AuthError extends Error {
  /**
   * Discriminant tag for error channel matching.
   * @readonly
   */
  readonly _tag = "AuthError" as const;

  constructor(
    /**
     * Machine-readable error code.
     * @readonly
     */
    readonly code: AuthErrorCode,
    message?: string,
    /**
     * Optional structured context for diagnostics.
     * @readonly
     */
    readonly context?: Record<string, unknown>,
  ) {
    super(message ?? AUTH_ERRORS[code]);
  }

  /** Convert to the `ConvexError` shape the Convex runtime expects. */
  toConvexError(): ConvexError<{ code: AuthErrorCode; message: string }> {
    return Cv.error({
      code: this.code,
      message: this.message,
      ...this.context,
    });
  }
}
