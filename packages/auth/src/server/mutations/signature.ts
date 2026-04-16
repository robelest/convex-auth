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

export async function verifierSignatureImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifierSignatureArgs>,
  config: Provider.Config,
): Promise<ReturnType> {
  const { verifier, signature } = args;
  const db = authDb(ctx, config);
  const invalidVerifierError = new ConvexError({
    code: "INVALID_VERIFIER",
    message: "Invalid or expired verifier.",
  });

  let verifierDoc;
  try {
    verifierDoc = await db.verifiers.getById(verifier as GenericId<"AuthVerifier">);
  } catch {
    throw invalidVerifierError;
  }

  if (verifierDoc == null) {
    throw invalidVerifierError;
  }

  await db.verifiers.patch(verifierDoc._id, { signature });
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
