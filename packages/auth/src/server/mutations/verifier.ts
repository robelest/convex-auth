import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";
import { Effect } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { getAuthSessionId } from "../sessions";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type ReturnType = GenericId<"AuthVerifier">;

export const verifierArgs = v.object({
  signature: v.optional(v.string()),
});

export function verifierImpl(
  ctx: MutationCtx,
  args: Infer<typeof verifierArgs>,
  config: Provider.Config,
): Effect.Effect<ReturnType> {
  return Effect.flatMap(
    Effect.promise(() => getAuthSessionId(ctx)),
    (sessionId) =>
      Effect.promise(() =>
        authDb(ctx, config).verifiers.create(
          sessionId ?? undefined,
          args.signature,
        ),
      ).pipe(Effect.map((verifierId) => verifierId as ReturnType)),
  );
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
