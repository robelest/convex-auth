/**
 * Configure the password provider for email/password authentication.
 *
 * The password provider supports the following flows, determined
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
 * import { password } from "@robelest/convex-auth/providers";
 *
 * password()
 * ```
 *
 * @module
 */

import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Fx } from "@robelest/fx";
import {
  DocumentByName,
  GenericDataModel,
  WithoutSystemFields,
} from "convex/server";
import { Value } from "convex/values";

import type {
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  GenericDoc,
  AuthProviderConfig,
  ConvexCredentialsConfig,
} from "../server/types";
import { credentials, type CredentialsConfig } from "./credentials";

/** Configuration for the {@link password} provider. */
export interface PasswordConfig<DataModel extends GenericDataModel> {
  /**
   * Uniquely identifies the provider, allowing to use
   * multiple different password providers.
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
  ) => WithoutSystemFields<DocumentByName<DataModel, "User">> & {
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
   * An email provider used to require verification
   * before password reset.
   */
  reset?: EmailConfig | ((...args: any) => EmailConfig);
  /**
   * An email provider used to require verification
   * before sign up / sign in.
   */
  verify?: EmailConfig | ((...args: any) => EmailConfig);
}

type PasswordFlowDispatch =
  | { tag: "signUp" }
  | { tag: "signIn" }
  | { tag: "reset" }
  | { tag: "resetVerification" }
  | { tag: "emailVerification" }
  | { tag: "invalid"; flow: unknown };

const PASSWORD_FLOW_TAG = {
  signUp: "signUp",
  signIn: "signIn",
  reset: "reset",
  "reset-verification": "resetVerification",
  "email-verification": "emailVerification",
} as const;

type PasswordFlowInput = keyof typeof PASSWORD_FLOW_TAG;

function decodePasswordFlow(flow: unknown): PasswordFlowDispatch {
  if (typeof flow !== "string") {
    return { tag: "invalid", flow };
  }

  const tag = PASSWORD_FLOW_TAG[flow as PasswordFlowInput];
  return tag === undefined ? { tag: "invalid", flow } : { tag };
}

/**
 * Email and password authentication provider.
 *
 * Passwords are by default hashed using scrypt.
 * You can customize the hashing via the `crypto` option.
 *
 * Email verification is not required unless you pass
 * an email provider to the `verify` option.
 *
 * @example
 * ```ts
 * import { password } from "@robelest/convex-auth/providers";
 *
 * password()
 * password({ verify: myEmailProvider })
 * ```
 *
 * @typeParam DataModel - The Convex data model used by the auth context.
 * @param config - Password flow hooks and optional verification providers.
 * @returns A configured password provider for `createAuth`.
 * @throws {Error} During sign-in flows when required password params are missing or reset is not enabled.
 */
export function password<DataModel extends GenericDataModel = GenericDataModel>(
  config: PasswordConfig<DataModel> = {} as PasswordConfig<DataModel>,
): ConvexCredentialsConfig {
  const provider = config.id ?? "password";

  return credentials<DataModel>({
    id: provider,
    authorize: async (params, ctx) => {
      const flowDispatch = decodePasswordFlow(params.flow);

      const validatePasswordRequirements = (password: string) => {
        if (config.validatePasswordRequirements !== undefined) {
          config.validatePasswordRequirements(password);
          return;
        }
        validateDefaultPasswordRequirements(password);
      };

      await Fx.run(
        Fx.match(flowDispatch, flowDispatch.tag, {
          signUp: () =>
            Fx.sync(() => {
              validatePasswordRequirements(params.password as string);
            }),
          resetVerification: () =>
            Fx.sync(() => {
              validatePasswordRequirements(params.newPassword as string);
            }),
          signIn: () => Fx.succeed(undefined),
          reset: () => Fx.succeed(undefined),
          emailVerification: () => Fx.succeed(undefined),
          invalid: () => Fx.succeed(undefined),
        }),
      );

      const profile = config.profile?.(params, ctx) ?? defaultProfile(params);
      const { email } = profile;
      const requirePasswordParam = (
        value: unknown,
        flow: "signUp" | "signIn",
      ) => {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`Missing \`password\` param for \`${flow}\` flow`);
        }
        return value;
      };

      const finalizeCredentialsResult = async (
        account: GenericDoc<DataModel, "Account">,
        user: GenericDoc<DataModel, "User">,
      ) => {
        if (config.verify && !account.emailVerified) {
          return await ctx.auth.provider.signIn(
            ctx,
            config.verify as AuthProviderConfig,
            {
              accountId: account._id,
              params,
            },
          );
        }
        return { userId: user._id };
      };

      return await Fx.run(
        Fx.match(flowDispatch, flowDispatch.tag, {
          signUp: () =>
            Fx.promise(async () => {
              const secret = requirePasswordParam(params.password, "signUp");
              const created = await ctx.auth.account.create(ctx, {
                provider,
                account: { id: email, secret },
                profile: profile as any,
                shouldLinkViaEmail: config.verify !== undefined,
                shouldLinkViaPhone: false,
              });
              return await finalizeCredentialsResult(
                created.account,
                created.user,
              );
            }),
          signIn: () =>
            Fx.promise(async () => {
              const secret = requirePasswordParam(params.password, "signIn");
              const retrieved = await ctx.auth.account.get(ctx, {
                provider,
                account: { id: email, secret },
              });
              if (retrieved === null) {
                throw new Error("Invalid credentials");
              }
              return await finalizeCredentialsResult(
                retrieved.account,
                retrieved.user,
              );
            }),
          reset: () =>
            Fx.promise(async () => {
              if (!config.reset) {
                throw new Error(
                  `Password reset is not enabled for ${provider}`,
                );
              }
              const { account } = await ctx.auth.account.get(ctx, {
                provider,
                account: { id: email },
              });
              return await ctx.auth.provider.signIn(
                ctx,
                config.reset as AuthProviderConfig,
                {
                  accountId: account._id,
                  params,
                },
              );
            }),
          resetVerification: () =>
            Fx.promise(async () => {
              if (!config.reset) {
                throw new Error(
                  `Password reset is not enabled for ${provider}`,
                );
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
              await ctx.auth.session.invalidate(ctx, {
                userId,
                except: [sessionId],
              });
              return { userId, sessionId };
            }),
          emailVerification: () =>
            Fx.promise(async () => {
              if (!config.verify) {
                throw new Error(
                  `Email verification is not enabled for ${provider}`,
                );
              }
              const { account } = await ctx.auth.account.get(ctx, {
                provider,
                account: { id: email },
              });
              return await ctx.auth.provider.signIn(
                ctx,
                config.verify as AuthProviderConfig,
                {
                  accountId: account._id,
                  params,
                },
              );
            }),
          invalid: () =>
            Fx.fatal(
              new Error(
                "Missing `flow` param, it must be one of " +
                  '"signUp", "signIn", "reset", "reset-verification" or ' +
                  '"email-verification"!',
              ),
            ),
        }),
      );
    },
    crypto: config.crypto ?? {
      async hashSecret(password: string) {
        return await hashPassword(password);
      },
      async verifySecret(password: string, hash: string) {
        return await verifyPassword(password, hash);
      },
    },
    extraProviders: [
      config.reset as AuthProviderConfig | undefined,
      config.verify as AuthProviderConfig | undefined,
    ],
    ...config,
  });
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
  const email = params.email;
  if (typeof email !== "string" || email.trim().length === 0) {
    throw new Error("Missing `email` param");
  }
  return {
    email,
  };
}

const PASSWORD_HASH_PARAMS = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64,
} as const;

const PASSWORD_HASH_PREFIX = `scrypt:N=${PASSWORD_HASH_PARAMS.N},r=${PASSWORD_HASH_PARAMS.r},p=${PASSWORD_HASH_PARAMS.p},dkLen=${PASSWORD_HASH_PARAMS.dkLen}`;

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const hash = await scryptAsync(password, salt, PASSWORD_HASH_PARAMS);
  return `${PASSWORD_HASH_PREFIX}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [prefix, saltHex, hashHex] = storedHash.split("$");
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    saltHex === undefined ||
    hashHex === undefined
  ) {
    return false;
  }

  let salt: Uint8Array;
  let expectedHash: Uint8Array;
  try {
    salt = hexToBytes(saltHex);
    expectedHash = hexToBytes(hashHex);
  } catch {
    return false;
  }
  if (
    salt.length !== 32 ||
    expectedHash.length !== PASSWORD_HASH_PARAMS.dkLen
  ) {
    return false;
  }

  const actualHash = await scryptAsync(password, salt, PASSWORD_HASH_PARAMS);
  return constantTimeEqual(actualHash, expectedHash);
}

function hexToBytes(hex: string) {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid password hash");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const start = i * 2;
    const value = Number.parseInt(hex.slice(start, start + 2), 16);
    if (Number.isNaN(value)) {
      throw new Error("Invalid password hash");
    }
    bytes[i] = value;
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}
