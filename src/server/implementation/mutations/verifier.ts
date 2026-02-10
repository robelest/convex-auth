import { GenericId } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { getAuthSessionId } from "../sessions.js";
import * as Provider from "../provider.js";
import { createAuthDb } from "../db.js";

type ReturnType = GenericId<"authVerifiers">;

export async function verifierImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Promise<ReturnType> {
  const sessionId = (await getAuthSessionId(ctx)) ?? undefined;
  if (config.component !== undefined) {
    return (await createAuthDb(ctx, config.component).verifiers.create(sessionId)) as
      ReturnType;
  }
  return await ctx.db.insert("authVerifiers", {
    sessionId,
  });
}

export const callVerifier = async (ctx: ActionCtx): Promise<ReturnType> => {
  return ctx.runMutation("auth:store" as any, {
    args: {
      type: "verifier",
    },
  });
};
