import { GenericId, Infer, v } from "convex/values";
import { deleteSession } from "../sessions.js";
import { ActionCtx, MutationCtx } from "../types.js";
import { LOG_LEVELS, logWithLevel } from "../utils.js";
import * as Provider from "../provider.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./store.js";

export const invalidateSessionsArgs = v.object({
  userId: v.string(),
  except: v.optional(v.array(v.string())),
});

export const callInvalidateSessions = async (
  ctx: ActionCtx,
  args: Infer<typeof invalidateSessionsArgs>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "invalidateSessions",
      ...args,
    },
  });
};

export const invalidateSessionsImpl = async (
  ctx: MutationCtx,
  args: Infer<typeof invalidateSessionsArgs>,
  config: Provider.Config,
): Promise<void> => {
  logWithLevel(LOG_LEVELS.DEBUG, "invalidateSessionsImpl args:", args);
  const { userId, except } = args;
  const exceptSet = new Set(except ?? []);
  const typedUserId = userId as GenericId<"user">;
  const sessions = await authDb(ctx, config).sessions.listByUser(typedUserId);
  for (const session of sessions) {
    if (!exceptSet.has(session._id)) {
      await deleteSession(ctx, session, config);
    }
  }
  return;
};
