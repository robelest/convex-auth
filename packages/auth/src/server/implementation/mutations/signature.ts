import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import { throwAuthError } from "../../errors";
import { authDb } from "../db";
import * as Provider from "../provider";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store";

export const verifierSignatureArgs = v.object({
  verifier: v.string(),
  signature: v.string(),
});

type ReturnType = void;

export async function verifierSignatureImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifierSignatureArgs>,
  config: Provider.Config,
): Promise<ReturnType> {
  const { verifier, signature } = args;
  const db = authDb(ctx, config);
  const verifierDoc = await db.verifiers.getById(
    verifier as GenericId<"AuthVerifier">,
  );
  if (verifierDoc === null) {
    throwAuthError("INVALID_VERIFIER");
  }
  return await db.verifiers.patch(verifierDoc._id, { signature });
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
