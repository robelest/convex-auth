import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId } from "convex/values";
import { Effect, Option, pipe } from "effect";

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
): Effect.Effect<ReturnType> {
  const db = authDb(ctx, config);
  return Effect.gen(function* () {
    const sessionId = yield* Effect.promise(() => getAuthSessionId(ctx));
    return yield* pipe(
      Option.fromNullishOr(sessionId),
      Option.match({
        onNone: () => Effect.succeed(null),
        onSome: (sessionId) =>
          Effect.flatMap(
            Effect.promise(() => db.sessions.getById(sessionId)),
            (session) =>
              pipe(
                Option.fromNullishOr(session),
                Option.match({
                  onNone: () => Effect.succeed(null),
                  onSome: (session) =>
                    Effect.as(
                      Effect.promise(() => deleteSession(ctx, session, config)),
                      {
                        userId: session.userId,
                        sessionId: session._id,
                      } satisfies Exclude<ReturnType, null>,
                    ),
                }),
              ),
          ),
      }),
    );
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
