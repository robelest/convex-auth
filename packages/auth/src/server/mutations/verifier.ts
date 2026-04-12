import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";
import { Effect } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { getAuthSessionId } from "../sessions";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type ReturnType = GenericId<"AuthVerifier">;

export function verifierImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Effect.Effect<ReturnType> {
  return Effect.flatMap(Effect.promise(() => getAuthSessionId(ctx)), (sessionId) =>
    Effect.promise(
      () => authDb(ctx, config).verifiers.create(sessionId ?? undefined),
    ).pipe(Effect.map((verifierId) => verifierId as ReturnType)),
  );
}

export const callVerifier = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "verifier",
    },
  }) as Promise<ReturnType>;
};
