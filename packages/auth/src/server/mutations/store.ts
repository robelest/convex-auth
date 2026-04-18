import { Infer, v } from "convex/values";

import { LOG_LEVELS } from "../log";
import { log } from "../log";
import type { ServerServices } from "../services/resolve";
import { MutationCtx } from "../types";
import { modifyAccountArgs, modifyAccountImpl } from "./account";
import { createVerificationCodeArgs, createVerificationCodeImpl } from "./code";
import { credentialsSignInArgs, credentialsSignInImpl } from "./credentialsSignIn";
import { invalidateSessionsArgs, invalidateSessionsImpl } from "./invalidate";
import { userOAuthArgs, userOAuthImpl } from "./oauth";
import { refreshSessionArgs } from "./refresh";
import { createAccountFromCredentialsArgs, createAccountFromCredentialsImpl } from "./register";
import { retrieveAccountWithCredentialsArgs, retrieveAccountWithCredentialsImpl } from "./retrieve";
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
      type: v.literal("credentialsSignIn"),
      ...credentialsSignInArgs.fields,
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

  const handlers: Record<string, (a: typeof args) => Promise<unknown>> = {
    signIn: (a) => signInImpl(ctx, a as Infer<typeof signInArgs> & { type: string }, config),
    signOut: () => signOutImpl(ctx, config),
    refreshSession: (a) =>
      services.refresh.refresh(ctx, a as Infer<typeof refreshSessionArgs> & { type: string }),
    verifyCodeAndSignIn: (a) =>
      verifyCodeAndSignInImpl(
        ctx,
        a as Infer<typeof verifyCodeAndSignInArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    verifier: (a) => verifierImpl(ctx, a as Infer<typeof verifierArgs> & { type: string }, config),
    verifierSignature: (a) =>
      verifierSignatureImpl(
        ctx,
        a as Infer<typeof verifierSignatureArgs> & { type: string },
        config,
      ),
    userOAuth: (a) =>
      userOAuthImpl(
        ctx,
        a as Infer<typeof userOAuthArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    createVerificationCode: (a) =>
      createVerificationCodeImpl(
        ctx,
        a as Infer<typeof createVerificationCodeArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    createAccountFromCredentials: (a) =>
      createAccountFromCredentialsImpl(
        ctx,
        a as Infer<typeof createAccountFromCredentialsArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    retrieveAccountWithCredentials: (a) =>
      retrieveAccountWithCredentialsImpl(
        ctx,
        a as Infer<typeof retrieveAccountWithCredentialsArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    credentialsSignIn: (a) =>
      credentialsSignInImpl(
        ctx,
        a as Infer<typeof credentialsSignInArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    modifyAccount: (a) =>
      modifyAccountImpl(
        ctx,
        a as Infer<typeof modifyAccountArgs> & { type: string },
        getProviderOrThrow,
        config,
      ),
    invalidateSessions: (a) =>
      invalidateSessionsImpl(
        ctx,
        a as Infer<typeof invalidateSessionsArgs> & { type: string },
        config,
      ),
  };

  const handler = handlers[args.type];
  if (!handler) {
    throw new Error(`Unknown store type: "${args.type}"`);
  }
  return await handler(args);
};
