import { GenericId } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { deleteSession, getAuthSessionId } from "../sessions.js";
import * as Provider from "../provider.js";
import { createAuthDb } from "../db.js";

type ReturnType = {
  userId: GenericId<"users">;
  sessionId: GenericId<"authSessions">;
} | null;

export async function signOutImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Promise<ReturnType> {
  const authDb =
    config.component !== undefined ? createAuthDb(ctx, config.component) : null;
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId !== null) {
    const session =
      authDb !== null
        ? await authDb.sessions.getById(sessionId)
        : await ctx.db.get(sessionId);
    if (session !== null) {
      await deleteSession(ctx, session, config);
      return { userId: session.userId, sessionId: session._id };
    }
  }
  return null;
}

export const callSignOut = async (ctx: ActionCtx): Promise<void> => {
  return ctx.runMutation("auth:store" as any, {
    args: {
      type: "signOut",
    },
  });
};
