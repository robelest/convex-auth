import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import { getAuthSessionId, issueSession } from "../sessions";
import { MutationCtx, SessionInfo } from "../types";
import { AUTH_STORE_REF } from "./store/refs";

export const signInArgs = v.object({
  userId: v.string(),
  sessionId: v.optional(v.string()),
  generateTokens: v.boolean(),
});

type ReturnType = SessionInfo;

export async function signInImpl(
  ctx: MutationCtx,
  args: Infer<typeof signInArgs>,
  config: Provider.Config,
): Promise<ReturnType> {
  log(LOG_LEVELS.DEBUG, "signInImpl args:", args);
  const { userId, sessionId: existingSessionId, generateTokens } = args;
  const typedUserId = userId as GenericId<"User">;
  const replaceSessionId =
    existingSessionId === undefined
      ? ((await getAuthSessionId(ctx)) ?? undefined)
      : undefined;
  return await issueSession(ctx, config, {
    userId: typedUserId,
    existingSessionId: existingSessionId as GenericId<"Session"> | undefined,
    replaceSessionId,
    generateTokens,
  });
}

export const callSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtx<DataModel>,
  args: Infer<typeof signInArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signIn",
      ...args,
    },
  }) as Promise<ReturnType>;
};
