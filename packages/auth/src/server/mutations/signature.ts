import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { ConvexError, GenericId, Infer, v } from "convex/values";

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
): Fx<ReturnType, ConvexError<any>> {
  return Fx.gen(function* () {
    const { verifier, signature } = args;
    const db = authDb(ctx, config);
    const verifierDoc = yield* Fx.from({
      ok: () => db.verifiers.getById(verifier as GenericId<"AuthVerifier">),
      err: () =>
        Cv.error({
          code: "INVALID_VERIFIER",
          message: "Invalid or expired verifier.",
        }),
    }).pipe(
      Fx.chain((doc) =>
        doc === null
          ? Cv.fail({
              code: "INVALID_VERIFIER",
              message: "Invalid or expired verifier.",
            })
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
