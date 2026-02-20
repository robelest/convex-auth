import { GenericId } from "convex/values";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { MutationCtx } from "../types";
import { getAuthSessionId } from "../sessions";
import * as Provider from "../provider";
import { authDb } from "../db";
import { AUTH_STORE_REF } from "./store";

type ReturnType = GenericId<"verifier">;

export async function verifierImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Promise<ReturnType> {
  const sessionId = (await getAuthSessionId(ctx)) ?? undefined;
  return (await authDb(ctx, config).verifiers.create(sessionId)) as ReturnType;
}

export const callVerifier = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifier",
    },
  });
};
