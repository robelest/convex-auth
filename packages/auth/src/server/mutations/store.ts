import { Fx } from "@robelest/fx";
import { Infer, v } from "convex/values";

import * as Provider from "../crypto";
import { MutationCtx } from "../types";
import { LOG_LEVELS, logWithLevel } from "../utils";
import { modifyAccountArgs, modifyAccountImpl } from "./account";
import { createVerificationCodeArgs, createVerificationCodeImpl } from "./code";
import { invalidateSessionsArgs, invalidateSessionsImpl } from "./invalidate";
import { userOAuthArgs, userOAuthImpl } from "./oauth";
import { refreshSessionArgs, refreshSessionImpl } from "./refresh";
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
import { verifierImpl } from "./verifier";
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
  getProviderOrThrow: Provider.GetProviderOrThrowFunc,
  config: Provider.Config,
) => {
  const args = fnArgs.args;
  logWithLevel(LOG_LEVELS.INFO, `\`auth:store\` type: ${args.type}`);
  return Fx.run(
    Fx.match(args, args.type, {
      signIn: (a) => Fx.promise(() => signInImpl(ctx, a, config)),
      signOut: () => signOutImpl(ctx, config),
      refreshSession: (a) =>
        Fx.promise(() =>
          refreshSessionImpl(ctx, a, getProviderOrThrow, config),
        ),
      verifyCodeAndSignIn: (a) =>
        Fx.promise(() =>
          verifyCodeAndSignInImpl(ctx, a, getProviderOrThrow, config),
        ),
      verifier: () => verifierImpl(ctx, config),
      verifierSignature: (a) =>
        verifierSignatureImpl(ctx, a, config).pipe(
          Fx.recover((e) => Fx.fatal(e)),
        ),
      userOAuth: (a) =>
        userOAuthImpl(ctx, a, getProviderOrThrow, config).pipe(
          Fx.recover((e) => Fx.fatal(e)),
        ),
      createVerificationCode: (a) =>
        Fx.promise(() =>
          createVerificationCodeImpl(ctx, a, getProviderOrThrow, config),
        ),
      createAccountFromCredentials: (a) =>
        Fx.promise(() =>
          createAccountFromCredentialsImpl(ctx, a, getProviderOrThrow, config),
        ),
      retrieveAccountWithCredentials: (a) =>
        retrieveAccountWithCredentialsImpl(ctx, a, getProviderOrThrow, config),
      modifyAccount: (a) =>
        modifyAccountImpl(ctx, a, getProviderOrThrow, config).pipe(
          Fx.recover((e) => Fx.fatal(e)),
        ),
      invalidateSessions: (a) => invalidateSessionsImpl(ctx, a, config),
    }),
  );
};
