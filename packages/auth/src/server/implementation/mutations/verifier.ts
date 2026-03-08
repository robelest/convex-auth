import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import { authDb } from "../db";
import * as Provider from "../provider";
import { getAuthSessionId } from "../sessions";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store";

type ReturnType = GenericId<"AuthVerifier">;

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
