import { Infer, v } from "convex/values";
import { Cause, Effect, Exit, Match } from "effect";

import { LOG_LEVELS } from "../log";
import { log } from "../log";
import type { ServerServices } from "../services/resolve";
import { MutationCtx } from "../types";
import { modifyAccountArgs, modifyAccountImpl } from "./account";
import { createVerificationCodeArgs, createVerificationCodeImpl } from "./code";
import { invalidateSessionsArgs, invalidateSessionsImpl } from "./invalidate";
import { userOAuthArgs, userOAuthImpl } from "./oauth";
import { refreshSessionArgs } from "./refresh";
import {
  createAccountFromCredentialsArgs,
  createAccountFromCredentialsImpl,
} from "./register";
import {
  retrieveAccountWithCredentialsArgs,
  retrieveAccountWithCredentialsImpl,
} from "./retrieve";
import { verifierSignatureArgs, verifierSignatureImpl } from "./signature";
import { signInArgs, signInImpl } from "./signin";
import { signOutImpl } from "./signout";
import { verifierArgs, verifierImpl } from "./verifier";
import { verifyCodeAndSignInArgs, verifyCodeAndSignInImpl } from "./verify";

export const storeArgs = v.object({
  args: v.union(
    v.object({
      type: v.literal("signIn"),
      ...signInArgs.fields,
    }),
    v.object({
      type: v.literal("signOut"),
    }),
    v.object({
      type: v.literal("refreshSession"),
      ...refreshSessionArgs.fields,
    }),
    v.object({
      type: v.literal("verifyCodeAndSignIn"),
      ...verifyCodeAndSignInArgs.fields,
    }),
    v.object({
      type: v.literal("verifier"),
      ...verifierArgs.fields,
    }),
    v.object({
      type: v.literal("verifierSignature"),
      ...verifierSignatureArgs.fields,
    }),
    v.object({
      type: v.literal("userOAuth"),
      ...userOAuthArgs.fields,
    }),
    v.object({
      type: v.literal("createVerificationCode"),
      ...createVerificationCodeArgs.fields,
    }),
    v.object({
      type: v.literal("createAccountFromCredentials"),
      ...createAccountFromCredentialsArgs.fields,
    }),
    v.object({
      type: v.literal("retrieveAccountWithCredentials"),
      ...retrieveAccountWithCredentialsArgs.fields,
    }),
    v.object({
      type: v.literal("modifyAccount"),
      ...modifyAccountArgs.fields,
    }),
    v.object({
      type: v.literal("invalidateSessions"),
      ...invalidateSessionsArgs.fields,
    }),
  ),
});

export const storeImpl = async (
  ctx: MutationCtx,
  fnArgs: Infer<typeof storeArgs>,
  services: ServerServices,
) => {
  const args = fnArgs.args;
  const config = services.config;
  const getProviderOrThrow = services.providerRegistry.getProviderOrThrow;
  log(LOG_LEVELS.DEBUG, `\`auth:store\` type: ${args.type}`);

  const program = Match.value(args).pipe(
    Match.when({ type: "signIn" }, (args) =>
      Effect.promise(() => signInImpl(ctx, args, config)),
    ),
    Match.when({ type: "signOut" }, () => signOutImpl(ctx, config)),
    Match.when({ type: "refreshSession" }, (args) =>
      services.refresh.refresh(ctx, args),
    ),
    Match.when({ type: "verifyCodeAndSignIn" }, (args) =>
      verifyCodeAndSignInImpl(ctx, args, getProviderOrThrow, config),
    ),
    Match.when({ type: "verifier" }, (args) => verifierImpl(ctx, args, config)),
    Match.when({ type: "verifierSignature" }, (args) =>
      verifierSignatureImpl(ctx, args, config),
    ),
    Match.when({ type: "userOAuth" }, (args) =>
      userOAuthImpl(ctx, args, getProviderOrThrow, config),
    ),
    Match.when({ type: "createVerificationCode" }, (args) =>
      Effect.promise(() =>
        createVerificationCodeImpl(ctx, args, getProviderOrThrow, config),
      ),
    ),
    Match.when({ type: "createAccountFromCredentials" }, (args) =>
      createAccountFromCredentialsImpl(ctx, args, getProviderOrThrow, config),
    ),
    Match.when({ type: "retrieveAccountWithCredentials" }, (args) =>
      retrieveAccountWithCredentialsImpl(ctx, args, getProviderOrThrow, config),
    ),
    Match.when({ type: "modifyAccount" }, (args) =>
      modifyAccountImpl(ctx, args, getProviderOrThrow, config),
    ),
    Match.when({ type: "invalidateSessions" }, (args) =>
      invalidateSessionsImpl(ctx, args, config),
    ),
    Match.exhaustive,
  );

  const exit = await Effect.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (value) => value,
    onFailure: (cause) => {
      throw Cause.squash(cause);
    },
  });
};
