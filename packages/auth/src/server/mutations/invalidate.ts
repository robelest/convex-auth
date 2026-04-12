import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";
import { Effect } from "effect";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { deleteSession } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import { AUTH_STORE_REF } from "./store/refs";

export const invalidateSessionsArgs = v.object({
  userId: v.string(),
  except: v.optional(v.array(v.string())),
});

export const callInvalidateSessions = async <
  DataModel extends GenericDataModel,
>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof invalidateSessionsArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "invalidateSessions",
      ...args,
    },
  }) as Promise<void>;
};

export function invalidateSessionsImpl(
  ctx: MutationCtx,
  args: Infer<typeof invalidateSessionsArgs>,
  config: Provider.Config,
): Effect.Effect<void> {
  log(LOG_LEVELS.DEBUG, "invalidateSessionsImpl args:", args);
  const { userId, except } = args;
  const exceptSet = new Set(except ?? []);
  const typedUserId = userId as GenericId<"User">;
  return Effect.gen(function* () {
    const sessions = (yield* Effect.promise(() =>
      authDb(ctx, config).sessions.listByUser(typedUserId),
    )) as Doc<"Session">[];
    yield* Effect.forEach(sessions, (session) =>
      exceptSet.has(session._id)
        ? Effect.void
        : Effect.promise(() => deleteSession(ctx, session, config)),
      { discard: true },
    );
  });
}
