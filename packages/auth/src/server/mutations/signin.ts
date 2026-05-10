import type { GenericDataModel } from "convex/server";
import { GenericId, Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { LOG_LEVELS } from "../log";
import { log } from "../log";
import { finalizeSessionIssuance, getAuthSessionId, issueSession } from "../sessions";
import type { SessionIssuance } from "../sessions";
import { buildSignInIdentityAttributes } from "../telemetry";
import { GenericActionCtxWithAuthConfig, MutationCtx, SessionInfo } from "../types";
import { setActiveSpanAttributes, withSpan } from "../utils/span";
import { AUTH_STORE_REF } from "./store/refs";

export const signInArgs = v.object({
  userId: v.string(),
  sessionId: v.optional(v.string()),
  generateTokens: v.boolean(),
});

export async function signInImpl(
  ctx: MutationCtx,
  args: Infer<typeof signInArgs>,
  config: Provider.Config,
): Promise<SessionIssuance> {
  return withSpan(
    "convex-auth.mutations.signIn",
    {
      "auth.flow": "signIn",
      hasExistingSession: args.sessionId !== undefined,
      generateTokens: args.generateTokens,
    },
    async () => {
      log(LOG_LEVELS.DEBUG, "signInImpl args:", args);
      const { userId, sessionId: existingSessionId, generateTokens } = args;
      const typedUserId = userId as GenericId<"User">;
      const replaceSessionId =
        existingSessionId === undefined ? ((await getAuthSessionId(ctx)) ?? undefined) : undefined;
      const issuance = await issueSession(ctx, config, {
        userId: typedUserId,
        existingSessionId: existingSessionId as GenericId<"Session"> | undefined,
        replaceSessionId,
        generateTokens,
      });
      setActiveSpanAttributes({
        "auth.signin.result": "success",
        ...(await buildSignInIdentityAttributes(ctx, config, {
          userId: issuance.userId,
          sessionId: issuance.sessionId,
        })),
      });
      // Fire `signedIn` event atomically with session creation.
      await config.callbacks?.after?.(ctx, {
        kind: "signedIn",
        userId: issuance.userId,
        sessionId: issuance.sessionId,
        provider: "session",
      });
      return issuance;
    },
  );
}

/**
 * Run the sign-in mutation, then sign the JWT on the action side.
 *
 * Splitting the work like this keeps the 5–30ms of RSA-2048 CPU out of the
 * mutation transaction so the mutation can commit quickly even on a cold
 * worker. The refresh-token string itself is cheap to compute and stays
 * inside the mutation (returned on the {@link SessionIssuance}); only the
 * JWT signing moves here.
 *
 * @internal
 */
export const callSignIn = async <DataModel extends GenericDataModel>(
  ctx: GenericActionCtxWithAuthConfig<DataModel>,
  args: Infer<typeof signInArgs>,
): Promise<SessionInfo> => {
  const issuance = (await ctx.runMutation(AUTH_STORE_REF, {
    args: {
      type: "signIn",
      ...args,
    },
  })) as SessionIssuance;
  return await finalizeSessionIssuance(ctx.auth.config, issuance);
};
