import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { deleteSession, getAuthSessionId } from "../sessions";
import { buildSignOutIdentityAttributes } from "../telemetry";
import { MutationCtx } from "../types";
import { setActiveSpanAttributes, withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

type ReturnType = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
} | null;

export async function signOutImpl(ctx: MutationCtx, config: Provider.Config): Promise<ReturnType> {
  return withSpan("convex-auth.mutations.signOut", { "auth.flow": "signOut" }, async () => {
    const db = authDb(ctx, config);
    const sessionId = await getAuthSessionId(ctx);
    if (sessionId == null) {
      setActiveSpanAttributes({ "auth.signout.result": "no_session" });
      return null;
    }
    const session = await db.sessions.getById(sessionId);
    if (session == null) {
      setActiveSpanAttributes({ "auth.signout.result": "session_missing" });
      return null;
    }
    await deleteSession(ctx, session, config);
    setActiveSpanAttributes({
      "auth.signout.result": "success",
      ...(await buildSignOutIdentityAttributes(ctx, config, {
        userId: session.userId,
        sessionId: session._id,
      })),
    });
    await config.callbacks?.after?.(ctx, {
      kind: "signedOut",
      userId: session.userId,
      sessionId: session._id,
    });
    return {
      userId: session.userId,
      sessionId: session._id,
    };
  });
}

export const callSignOut = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signOut",
    },
  }) as Promise<void>;
};
