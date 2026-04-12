import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, GenericId, Infer, v } from "convex/values";
import { Effect, Option, pipe } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

export const verifierSignatureArgs = v.object({
  verifier: v.string(),
  signature: v.string(),
});

type ReturnType = void;

export function verifierSignatureImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifierSignatureArgs>,
  config: Provider.Config,
): Effect.Effect<ReturnType, ConvexError<{ code: string; message: string }>> {
  const { verifier, signature } = args;
  const db = authDb(ctx, config);
  const invalidVerifierError = new ConvexError({
    code: "INVALID_VERIFIER",
    message: "Invalid or expired verifier.",
  });
  return Effect.gen(function* () {
    const verifierDoc = yield* Effect.tryPromise({
      try: () => db.verifiers.getById(verifier as GenericId<"AuthVerifier">),
      catch: () => invalidVerifierError,
    });
    const existingVerifier = yield* pipe(
      Option.fromNullishOr(verifierDoc),
      Option.match({
        onNone: () => Effect.fail(invalidVerifierError),
        onSome: (verifierDoc) => Effect.succeed(verifierDoc),
      }),
    );
    yield* Effect.promise(() =>
      db.verifiers.patch(existingVerifier._id, { signature }),
    );
  });
}

export const callVerifierSignature = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof verifierSignatureArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifierSignature",
      ...args,
    },
  }) as Promise<void>;
};
