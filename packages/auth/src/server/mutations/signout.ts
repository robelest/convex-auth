import { Fx } from "@robelest/fx";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";

import * as Provider from "../crypto";
import { authDb } from "../db";
import { deleteSession, getAuthSessionId } from "../sessions";
import { MutationCtx } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

type ReturnType = {
  userId: GenericId<"User">;
  sessionId: GenericId<"Session">;
} | null;

export function signOutImpl(
  ctx: MutationCtx,
  config: Provider.Config,
): Fx<ReturnType, never> {
  return Fx.gen(function* () {
    const db = authDb(ctx, config);
    const sessionId = yield* Fx.promise(() => getAuthSessionId(ctx));
    if (sessionId === null) {
      return null;
    }
    const session = yield* Fx.promise(() => db.sessions.getById(sessionId));
    if (session === null) {
      return null;
    }
    yield* Fx.promise(() => deleteSession(ctx, session, config));
    return { userId: session.userId, sessionId: session._id };
  });
}

export const callSignOut = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
): Promise<void> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signOut",
    },
  });
};
