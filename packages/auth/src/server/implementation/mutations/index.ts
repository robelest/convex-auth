import { Infer, v } from "convex/values";
import { MutationCtx } from "../types";
import { signInArgs, signInImpl } from "./signin";
import { signOutImpl } from "./signout";
import { refreshSessionArgs, refreshSessionImpl } from "./refresh";
import {
  verifyCodeAndSignInArgs,
  verifyCodeAndSignInImpl,
} from "./verify";
import {
  verifierSignatureArgs,
  verifierSignatureImpl,
} from "./signature";
import { userOAuthArgs, userOAuthImpl } from "./oauth";
import {
  createVerificationCodeArgs,
  createVerificationCodeImpl,
} from "./code";
import {
  createAccountFromCredentialsArgs,
  createAccountFromCredentialsImpl,
} from "./register";
import {
  retrieveAccountWithCredentialsArgs,
  retrieveAccountWithCredentialsImpl,
} from "./retrieve";
import { modifyAccountArgs, modifyAccountImpl } from "./account";
import {
  invalidateSessionsArgs,
  invalidateSessionsImpl,
} from "./invalidate";
import * as Provider from "../provider";
import { verifierImpl } from "./verifier";
import { LOG_LEVELS, logWithLevel } from "../utils";
export { callInvalidateSessions } from "./invalidate";
export { callModifyAccount } from "./account";
export {
  callRetrieveAccountWithCredentials,
  callRetreiveAccountWithCredentials,
} from "./retrieve";
export { callCreateAccountFromCredentials } from "./register";
export { callCreateVerificationCode } from "./code";
export { callUserOAuth } from "./oauth";
export { callVerifierSignature } from "./signature";
export { callVerifyCodeAndSignIn } from "./verify";
export { callVerifier } from "./verifier";
export { callRefreshSession } from "./refresh";
export { callSignOut } from "./signout";
export { callSignIn } from "./signin";

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
  switch (args.type) {
    case "signIn": {
      return signInImpl(ctx, args, config);
    }
    case "signOut": {
      return signOutImpl(ctx, config);
    }
    case "refreshSession": {
      return refreshSessionImpl(ctx, args, getProviderOrThrow, config);
    }
    case "verifyCodeAndSignIn": {
      return verifyCodeAndSignInImpl(ctx, args, getProviderOrThrow, config);
    }
    case "verifier": {
      return verifierImpl(ctx, config);
    }
    case "verifierSignature": {
      return verifierSignatureImpl(ctx, args, config);
    }
    case "userOAuth": {
      return userOAuthImpl(ctx, args, getProviderOrThrow, config);
    }
    case "createVerificationCode": {
      return createVerificationCodeImpl(ctx, args, getProviderOrThrow, config);
    }
    case "createAccountFromCredentials": {
      return createAccountFromCredentialsImpl(
        ctx,
        args,
        getProviderOrThrow,
        config,
      );
    }
    case "retrieveAccountWithCredentials": {
      return retrieveAccountWithCredentialsImpl(
        ctx,
        args,
        getProviderOrThrow,
        config,
      );
    }
    case "modifyAccount": {
      return modifyAccountImpl(ctx, args, getProviderOrThrow, config);
    }
    case "invalidateSessions": {
      return invalidateSessionsImpl(ctx, args, config);
    }
    default:
      args satisfies never;
  }
};
