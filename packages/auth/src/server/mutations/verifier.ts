import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import { authDb } from "../db";
import * as Provider from "../provider";
import { getAuthSessionId } from "../sessions";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store";

type ReturnType = GenericId<"AuthVerifier">;

export function verifierImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Fx<ReturnType, never> {
  return Fx.gen(function* () {
    return (yield* Fx.promise(async () =>
      authDb(ctx, config).verifiers.create(
        (await getAuthSessionId(ctx)) ?? undefined,
      ),
    )) as ReturnType;
  });
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
