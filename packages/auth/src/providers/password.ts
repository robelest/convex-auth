/**
 * Configure {@link Password} provider for email/password authentication.
 *
 * The `Password` provider supports the following flows, determined
 * by the `flow` parameter:
 *
 * - `"signUp"`: Create a new account with a password.
 * - `"signIn"`: Sign in with an existing account and password.
 * - `"reset"`: Request a password reset.
 * - `"reset-verification"`: Verify a password reset code and change password.
 * - `"email-verification"`: If email verification is enabled and `code` is
 *    included in params, verify an OTP.
 *
 * ```ts
 * import { Password } from "@robelest/convex-auth/providers";
 *
 * new Password()
 * ```
 *
 * @module
 */

import { Credentials, type CredentialsConfig } from "./credentials";
import type {
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  GenericDoc,
  AuthProviderConfig,
  ConvexCredentialsConfig,
} from "../server/types";
import {
  DocumentByName,
  GenericDataModel,
  WithoutSystemFields,
} from "convex/server";
import { Value } from "convex/values";
import { Scrypt } from "lucia";

/**
 * The available options to a {@link Password} provider for Convex Auth.
 */
export interface PasswordConfig<DataModel extends GenericDataModel> {
  /**
   * Uniquely identifies the provider, allowing to use
   * multiple different {@link Password} providers.
   */
  id?: string;
  /**
   * Perform checks on provided params and customize the user
   * information stored after sign up, including email normalization.
   *
   * Called for every flow ("signUp", "signIn", "reset",
   * "reset-verification" and "email-verification").
   */
  profile?: (
    /**
     * The values passed to the `signIn` function.
     */
    params: Record<string, Value | undefined>,
    /**
     * Convex ActionCtx in case you want to read from or write to
     * the database.
     */
    ctx: GenericActionCtxWithAuthConfig<DataModel>,
  ) => WithoutSystemFields<DocumentByName<DataModel, "user">> & {
    email: string;
  };
  /**
   * Performs custom validation on password provided during sign up or reset.
   *
   * Otherwise the default validation is used (password is not empty and
   * at least 8 characters in length).
   *
   * If the provided password is invalid, implementations must throw an Error.
   *
   * @param password the password supplied during "signUp" or
   *                 "reset-verification" flows.
   */
  validatePasswordRequirements?: (password: string) => void;
  /**
   * Provide hashing and verification functions if you want to control
   * how passwords are hashed.
   */
  crypto?: CredentialsConfig["crypto"];
  /**
   * An Auth.js email provider used to require verification
   * before password reset.
   */
  reset?: EmailConfig | ((...args: any) => EmailConfig);
  /**
   * An Auth.js email provider used to require verification
   * before sign up / sign in.
   */
  verify?: EmailConfig | ((...args: any) => EmailConfig);
}

/**
 * Email and password authentication provider.
 *
 * Passwords are by default hashed using Scrypt from Lucia.
 * You can customize the hashing via the `crypto` option.
 *
 * Email verification is not required unless you pass
 * an email provider to the `verify` option.
 *
 * @example
 * ```ts
 * import { Password } from "@robelest/convex-auth/providers";
 *
 * new Password()
 * new Password({ verify: myEmailProvider })
 * ```
 */
export class Password<DataModel extends GenericDataModel = GenericDataModel> {
  readonly id: string;
  readonly type = "credentials" as const;
  readonly config: PasswordConfig<DataModel>;

  constructor(config: PasswordConfig<DataModel> = {} as PasswordConfig<DataModel>) {
    this.id = config.id ?? "password";
    this.config = config;
  }

  /** @internal Convert to the internal materialized config shape. */
  _toMaterialized(): ConvexCredentialsConfig {
    const config = this.config;
    const provider = this.id;

    return new Credentials<DataModel>({
      id: "password",
      authorize: async (params, ctx) => {
        const flow = params.flow as string;
        const passwordToValidate =
          flow === "signUp"
            ? (params.password as string)
            : flow === "reset-verification"
              ? (params.newPassword as string)
              : null;
        if (passwordToValidate !== null) {
          if (config.validatePasswordRequirements !== undefined) {
            config.validatePasswordRequirements(passwordToValidate);
          } else {
            validateDefaultPasswordRequirements(passwordToValidate);
          }
        }
        const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
        const { email } = profile;
        const secret = params.password as string;
        let account: GenericDoc<DataModel, "account">;
        let user: GenericDoc<DataModel, "user">;
        if (flow === "signUp") {
          if (secret === undefined) {
            throw new Error("Missing `password` param for `signUp` flow");
          }
          const created = await ctx.auth.account.create(ctx, {
            provider,
            account: { id: email, secret },
            profile: profile as any,
            shouldLinkViaEmail: config.verify !== undefined,
            shouldLinkViaPhone: false,
          });
          ({ account, user } = created);
        } else if (flow === "signIn") {
          if (secret === undefined) {
            throw new Error("Missing `password` param for `signIn` flow");
          }
          const retrieved = await ctx.auth.account.get(ctx, {
            provider,
            account: { id: email, secret },
          });
          if (retrieved === null) {
            throw new Error("Invalid credentials");
          }
          ({ account, user } = retrieved);
        } else if (flow === "reset") {
          if (!config.reset) {
            throw new Error(`Password reset is not enabled for ${provider}`);
          }
          const { account } = await ctx.auth.account.get(ctx, {
            provider,
            account: { id: email },
          });
          return await ctx.auth.provider.signIn(ctx, config.reset as AuthProviderConfig, {
            accountId: account._id,
            params,
          });
        } else if (flow === "reset-verification") {
          if (!config.reset) {
            throw new Error(`Password reset is not enabled for ${provider}`);
          }
          if (params.newPassword === undefined) {
            throw new Error(
              "Missing `newPassword` param for `reset-verification` flow",
            );
          }
          const result = await ctx.auth.provider.signIn(
            ctx,
            config.reset as AuthProviderConfig,
            { params },
          );
          if (result === null) {
            throw new Error("Invalid code");
          }
          const { userId, sessionId } = result;
          const secret = params.newPassword as string;
          await ctx.auth.account.update(ctx, {
            provider,
            account: { id: email, secret },
          });
          await ctx.auth.session.invalidate(ctx, { userId, except: [sessionId] });
          return { userId, sessionId };
        } else if (flow === "email-verification") {
          if (!config.verify) {
            throw new Error(
              `Email verification is not enabled for ${provider}`,
            );
          }
          const { account } = await ctx.auth.account.get(ctx, {
            provider,
            account: { id: email },
          });
          return await ctx.auth.provider.signIn(ctx, config.verify as AuthProviderConfig, {
            accountId: account._id,
            params,
          });
        } else {
          throw new Error(
            "Missing `flow` param, it must be one of " +
              '"signUp", "signIn", "reset", "reset-verification" or ' +
              '"email-verification"!',
          );
        }
        if (config.verify && !account.emailVerified) {
          return await ctx.auth.provider.signIn(ctx, config.verify as AuthProviderConfig, {
            accountId: account._id,
            params,
          });
        }
        return { userId: user._id };
      },
      crypto: config.crypto ?? {
        async hashSecret(password: string) {
          return await new Scrypt().hash(password);
        },
        async verifySecret(password: string, hash: string) {
          return await new Scrypt().verify(hash, password);
        },
      },
      extraProviders: [
        config.reset as AuthProviderConfig | undefined,
        config.verify as AuthProviderConfig | undefined,
      ],
      ...config,
    })._toMaterialized();
  }
}

// ============================================================================
// Backward-compatible default export
// ============================================================================

/**
 * @deprecated Use `new Password(config)` instead.
 */
export default function password<DataModel extends GenericDataModel>(
  config: PasswordConfig<DataModel> = {} as PasswordConfig<DataModel>,
): ConvexCredentialsConfig {
  return new Password(config)._toMaterialized();
}

// ============================================================================
// Helpers
// ============================================================================

function validateDefaultPasswordRequirements(password: string) {
  if (!password || password.length < 8) {
    throw new Error("Invalid password");
  }
}

function defaultProfile(params: Record<string, unknown>) {
  return {
    email: params.email as string,
  };
}
