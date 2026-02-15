import { Infer, v } from "convex/values";
import { MutationCtx } from "../types.js";
import { signInArgs, signInImpl } from "./signin.js";
import { signOutImpl } from "./signout.js";
import { refreshSessionArgs, refreshSessionImpl } from "./refresh.js";
import {
  verifyCodeAndSignInArgs,
  verifyCodeAndSignInImpl,
} from "./verify.js";
import {
  verifierSignatureArgs,
  verifierSignatureImpl,
} from "./signature.js";
import { userOAuthArgs, userOAuthImpl } from "./oauth.js";
import {
  createVerificationCodeArgs,
  createVerificationCodeImpl,
} from "./code.js";
import {
  createAccountFromCredentialsArgs,
  createAccountFromCredentialsImpl,
} from "./register.js";
import {
  retrieveAccountWithCredentialsArgs,
  retrieveAccountWithCredentialsImpl,
} from "./retrieve.js";
import { modifyAccountArgs, modifyAccountImpl } from "./account.js";
import {
  invalidateSessionsArgs,
  invalidateSessionsImpl,
} from "./invalidate.js";
import * as Provider from "../provider.js";
import { verifierImpl } from "./verifier.js";
import { LOG_LEVELS, logWithLevel } from "../utils.js";
export { callInvalidateSessions } from "./invalidate.js";
export { callModifyAccount } from "./account.js";
export { callRetreiveAccountWithCredentials } from "./retrieve.js";
export { callCreateAccountFromCredentials } from "./register.js";
export { callCreateVerificationCode } from "./code.js";
export { callUserOAuth } from "./oauth.js";
export { callVerifierSignature } from "./signature.js";
export { callVerifyCodeAndSignIn } from "./verify.js";
export { callVerifier } from "./verifier.js";
export { callRefreshSession } from "./refresh.js";
export { callSignOut } from "./signout.js";
export { callSignIn } from "./signin.js";

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
