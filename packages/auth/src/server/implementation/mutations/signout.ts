import { GenericId } from "convex/values";
import { ActionCtx, MutationCtx } from "../types.js";
import { deleteSession, getAuthSessionId } from "../sessions.js";
import * as Provider from "../provider.js";
import { authDb } from "../db.js";
import { AUTH_STORE_REF } from "./store.js";

type ReturnType = {
  userId: GenericId<"user">;
  sessionId: GenericId<"session">;
} | null;

export async function signOutImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Promise<ReturnType> {
  const db = authDb(ctx, config);
  const sessionId = await getAuthSessionId(ctx);
  if (sessionId !== null) {
    const session = await db.sessions.getById(sessionId);
    if (session !== null) {
      await deleteSession(ctx, session, config);
      return { userId: session.userId, sessionId: session._id };
    }
  }
  return null;
}

export const callSignOut = async (ctx: ActionCtx): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signOut",
    },
  });
};
