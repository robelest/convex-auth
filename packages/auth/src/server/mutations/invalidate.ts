import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import { authDb } from "../db";
import * as Provider from "../provider";
import { deleteSession } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel } from "../utils";
import { AUTH_STORE_REF } from "./store";

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
  });
};

export function invalidateSessionsImpl(
  ctx: MutationCtx,
  args: Infer<typeof invalidateSessionsArgs>,
  config: Provider.Config,
): Fx<void, never> {
  return Fx.gen(function* () {
    logWithLevel(LOG_LEVELS.DEBUG, "invalidateSessionsImpl args:", args);
    const { userId, except } = args;
    const exceptSet = new Set(except ?? []);
    const typedUserId = userId as GenericId<"User">;
    const sessions = (yield* Fx.promise(() =>
      authDb(ctx, config).sessions.listByUser(typedUserId),
    )) as Doc<"Session">[];
    yield* Fx.each(sessions, (session: Doc<"Session">) =>
      exceptSet.has(session._id)
        ? Fx.unit
        : Fx.promise(() => deleteSession(ctx, session, config)),
    );
  });
}
