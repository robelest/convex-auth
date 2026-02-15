import { GenericId } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { getAuthSessionId } from "../sessions.js";
import * as Provider from "../provider.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./store.js";

type ReturnType = GenericId<"verifier">;

export async function verifierImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Promise<ReturnType> {
  const sessionId = (await getAuthSessionId(ctx)) ?? undefined;
  return (await authDb(ctx, config).verifiers.create(sessionId)) as ReturnType;
}

export const callVerifier = async (ctx: ActionCtx): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifier",
    },
  });
};
