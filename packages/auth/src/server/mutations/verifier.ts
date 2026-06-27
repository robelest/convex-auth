import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { getAuthSessionId } from "../session/lifecycle";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type ReturnType = GenericId<"AuthVerifier">;

export const vVerifierArgs = v.object({
  signature: v.optional(v.string()),
});

export async function verifierImpl(
  ctx: MutationCtx,
  args: Infer<typeof vVerifierArgs>,
  config: Provider.Config,
): Promise<ReturnType> {
  const sessionId = await getAuthSessionId(ctx);
  const verifierId = await authDb(ctx, config).verifiers.create(
    sessionId ?? undefined,
    args.signature,
  );
  return verifierId as ReturnType;
}

export const callVerifier = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  signature?: string,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifier",
      ...(signature === undefined ? {} : { signature }),
    },
  }) as Promise<ReturnType>;
};
