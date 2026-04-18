import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import { deleteSession } from "../sessions";
import { Doc, MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

export const invalidateSessionsArgs = v.object({
  userId: v.string(),
  except: v.optional(v.array(v.string())),
});

export const callInvalidateSessions = async <DataModel extends GenericDataModel>(
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

export async function invalidateSessionsImpl(
  ctx: MutationCtx,
  args: Infer<typeof invalidateSessionsArgs>,
  config: Provider.Config,
): Promise<void> {
  log(LOG_LEVELS.DEBUG, "invalidateSessionsImpl args:", args);
  const { userId, except } = args;
  const exceptSet = new Set(except ?? []);
  const typedUserId = userId as GenericId<"User">;
  const sessions = (await authDb(ctx, config).sessions.listByUser(typedUserId)) as Doc<"Session">[];
  await Promise.all(
    sessions.map((session) =>
      exceptSet.has(session._id) ? Promise.resolve() : deleteSession(ctx, session, config),
    ),
  );
}
