import { GenericId, Infer, v } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import * as Provider from "../provider.js";
import { createAuthDb } from "../db.js";

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
  const authDb =
    config.component !== undefined ? createAuthDb(ctx, config.component) : null;
  const verifierDoc =
    authDb !== null
      ? await authDb.verifiers.getById(verifier as GenericId<"verifier">)
      : await ctx.db.get(verifier as GenericId<"verifier">);
  if (verifierDoc === null) {
    throw new Error("Invalid verifier");
  }
  if (authDb !== null) {
    return await authDb.verifiers.patch(verifierDoc._id, { signature });
  }
  return await ctx.db.patch(verifierDoc._id, { signature });
}

export const callVerifierSignature = async (
  ctx: ActionCtx,
  args: Infer<typeof verifierSignatureArgs>,
): Promise<void> => {
  return ctx.runMutation("auth:store" as any, {
    args: {
      type: "verifierSignature",
      ...args,
    },
  });
};
