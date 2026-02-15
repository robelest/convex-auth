import { GenericId, Infer, v } from "convex/values";
import { ActionCtx, MutationCtx, SessionInfo } from "../types";
import * as Provider from "../provider";
import {
  createNewAndDeleteExistingSession,
  maybeGenerateTokensForSession,
} from "../sessions";
import { LOG_LEVELS, logWithLevel } from "../utils";
import { AUTH_STORE_REF } from "./store";

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
  logWithLevel(LOG_LEVELS.DEBUG, "signInImpl args:", args);
  const { userId, sessionId: existingSessionId, generateTokens } = args;
  const typedUserId = userId as GenericId<"user">;
  const typedExistingSessionId = existingSessionId as
    | GenericId<"session">
    | undefined;
  const sessionId =
    typedExistingSessionId ??
    (await createNewAndDeleteExistingSession(ctx, config, typedUserId));
  return await maybeGenerateTokensForSession(
    ctx,
    config,
    typedUserId,
    sessionId,
    generateTokens,
  );
}

export const callSignIn = async (
  ctx: ActionCtx,
  args: Infer<typeof signInArgs>,
): Promise<ReturnType> => {
  return ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signIn",
      ...args,
    },
  });
};
