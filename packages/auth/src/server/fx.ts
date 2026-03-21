/**
 * Fx utilities for Convex Auth.
 *
 * Provides the {@link AuthError} class for use with `Fx.fail()` and
 * small composable helpers that replace repeated imperative patterns
 * (null-check chains, throw-guards).
 *
 * @module
 */

import { Fx as BaseFx } from "@robelest/fx";
import type { Fx as FxType } from "@robelest/fx";
import { ConvexError } from "convex/values";

import { AUTH_ERRORS } from "./errors";
import type { AuthErrorCode } from "./errors";

type AnyFx = FxType<any, any>;

type MatchHandlers<T, K extends keyof T & string> = {
  [V in Extract<T[K], string>]: (value: Extract<T, Record<K, V>>) => unknown;
};

type HandlerSuccess<T> = T extends FxType<infer A, any> ? A : T;

type HandlerError<T> = T extends FxType<any, infer E> ? E : never;

type MatchSuccess<Handlers> = {
  [V in keyof Handlers]: Handlers[V] extends (...args: any[]) => infer R
    ? HandlerSuccess<R>
    : never;
}[keyof Handlers];

type MatchError<Handlers> = {
  [V in keyof Handlers]: Handlers[V] extends (...args: any[]) => infer R
    ? HandlerError<R>
    : never;
}[keyof Handlers];

type MatchBuilder<T> = {
  on<K extends keyof T & string, Handlers extends MatchHandlers<T, K>>(
    key: K,
    handlers: Handlers,
  ): FxType<MatchSuccess<Handlers>, MatchError<Handlers>>;
  on(
    key: string,
    handlers: Record<string, (value: any) => unknown>,
  ): FxType<any, any>;
};

const toFx = (value: unknown): AnyFx => {
  if (
    value !== null &&
    typeof value === "object" &&
    "_run" in value &&
    typeof (value as { _run?: unknown })._run === "function"
  ) {
    return value as AnyFx;
  }
  return BaseFx.succeed(value);
};

const toFxHandlers = (handlers: Record<string, (value: any) => unknown>) =>
  Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (value: any) => toFx(handler(value)),
    ]),
  ) as Record<string, (value: any) => AnyFx>;

function match<T>(value: T): MatchBuilder<T>;
function match<
  T extends Record<string, unknown>,
  K extends keyof T & string,
  Handlers extends MatchHandlers<T, K>,
>(
  value: T,
  tag: Extract<T[K], string>,
  handlers: Handlers,
): FxType<MatchSuccess<Handlers>, MatchError<Handlers>>;
function match<T>(
  value: T,
  tag?: string,
  handlers?: Record<string, (value: any) => unknown>,
) {
  if (tag === undefined || handlers === undefined) {
    return {
      on: (key: string, onHandlers: Record<string, (value: any) => unknown>) =>
        BaseFx.match(
          value as Record<string, string>,
          String((value as Record<string, unknown>)[key]),
          toFxHandlers(onHandlers),
        ),
    } as MatchBuilder<T>;
  }
  return BaseFx.match(
    value as Record<string, string>,
    tag,
    toFxHandlers(handlers),
  );
}

/** @internal */
export const Fx = {
  ...BaseFx,
  match,
} as Omit<typeof BaseFx, "match"> & {
  match: typeof match;
};

// ============================================================================
// AuthError — typed error for the Fx error channel
// ============================================================================

/**
 * Typed error for the Fx error channel.
 *
 * Use with `Fx.fail(new AuthError("CODE"))` in pipelines.
 * At Convex boundaries, {@link toConvexError} converts these to `ConvexError`.
 *
 * @example
 * ```ts
 * // In an Fx pipeline
 * Fx.fail(new AuthError("NOT_SIGNED_IN"));
 *
 * // With custom message
 * Fx.fail(new AuthError("INTERNAL_ERROR", "Something specific went wrong"));
 *
 * // With extra context
 * Fx.fail(new AuthError("MISSING_ENV_VAR", undefined, { variable: "SECRET" }));
 * ```
 */
export class AuthError extends Error {
  readonly _tag = "AuthError" as const;

  constructor(
    readonly code: AuthErrorCode,
    message?: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message ?? AUTH_ERRORS[code]);
  }

  /** Convert to the `ConvexError` shape the Convex runtime expects. */
  toConvexError(): ConvexError<{ code: AuthErrorCode; message: string }> {
    return new ConvexError({
      code: this.code,
      message: this.message,
      ...this.context,
    });
  }
}
