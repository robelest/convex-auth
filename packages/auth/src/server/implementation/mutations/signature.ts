import { GenericId, Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types";
import * as Provider from "../provider";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";
import { throwAuthError } from "../../errors";

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
  const verifierDoc = await db.verifiers.getById(verifier as GenericId<"verifier">);
  if (verifierDoc === null) {
    throwAuthError("INVALID_VERIFIER");
  }
  return await db.verifiers.patch(verifierDoc._id, { signature });
}

export const callVerifierSignature = async (
  ctx: ActionCtx,
  args: Infer<typeof verifierSignatureArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifierSignature",
      ...args,
    },
  });
};
