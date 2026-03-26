import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import { authDb } from "../db";
import { AuthError } from "../authError";
import * as Provider from "../crypto";
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
): Fx<ReturnType, AuthError> {
  return Fx.gen(function* () {
    const { verifier, signature } = args;
    const db = authDb(ctx, config);
    const verifierDoc = yield* Fx.from({
      ok: () => db.verifiers.getById(verifier as GenericId<"AuthVerifier">),
      err: () => new AuthError("INVALID_VERIFIER"),
    }).pipe(
      Fx.chain((doc) =>
        doc === null
          ? Fx.fail(new AuthError("INVALID_VERIFIER"))
          : Fx.succeed(doc),
      ),
    );
    yield* Fx.promise(() => db.verifiers.patch(verifierDoc._id, { signature }));
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
  });
};
