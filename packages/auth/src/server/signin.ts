import { GenericId, ConvexError, type Value } from "convex/values";

import { authFlowError } from "../shared/errors";
import { handleDevice } from "./device";
import { envOptionalString, readConfigSync } from "./env";
import { requireEnv } from "./env";
import type { AuthErrorData } from "./errors";
import { toConvexError } from "./errors";
import { log } from "./log";
import {
  callCreateVerificationCode,
  callRefreshSession,
  callSignIn,
  callVerifier,
  callVerifyCodeAndSignIn,
} from "./mutations/index";
import { handlePasskeyFx } from "./passkey";
import type { SignInParams } from "./payloads";
import { generateRandomString } from "./random";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { handleTotp } from "./totp";
import {
  AuthProviderMaterializedConfig,
  ConvexCredentialsConfig,
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  PhoneConfig,
} from "./types";
import {
  AuthDataModel,
  SessionInfo,
  SessionInfoWithTokens,
  Tokens,
  queryTotpVerifiedByUserId,
} from "./types";
import type { OAuthMaterializedConfig } from "./types";
import { withSpan } from "./utils/span";

const DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S = 60 * 60 * 24; // 24 hours

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

type SignInResult =
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "refreshTokens"; signedIn: { tokens: Tokens } }
  | { kind: "started"; started: true }
  | { kind: "redirect"; redirect: string; verifier: string }
  | {
      kind: "passkeyOptions";
      options: Record<string, unknown>;
      verifier: string;
    }
  | { kind: "totpRequired"; verifier: string }
  | {
      kind: "totpSetup";
      uri: string;
      secret: string;
      verifier: string;
      totpId: string;
    }
  | {
      kind: "deviceCode";
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    };

type VerificationParams = {
  email?: string;
  phone?: string;
  redirectTo?: unknown;
  connectionId?: unknown;
  loginHint?: unknown;
  protocol?: unknown;
  code?: unknown;
};

const normalizeVerificationParams = (params: SignInParams | undefined) => {
  const value = (params ?? {}) as VerificationParams;
  return {
    email: typeof value.email === "string" ? value.email : undefined,
    phone: typeof value.phone === "string" ? value.phone : undefined,
    redirectTo: value.redirectTo,
    connectionId: value.connectionId,
    loginHint: value.loginHint,
    protocol: value.protocol,
    code: value.code,
  };
};

const describeUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === null
  ) {
    return String(value);
  }
  const json = JSON.stringify(value);
  return json ?? Object.prototype.toString.call(value);
};

const asConvexError = (
  error: unknown,
  code: string,
  message: string,
): ConvexError<AuthErrorData> =>
  error instanceof ConvexError
    ? error
    : toConvexError(authFlowError(code, message));

const asCredentialsError = (error: unknown): ConvexError<AuthErrorData> => {
  if (error instanceof ConvexError) {
    return error as ConvexError<AuthErrorData>;
  }
  if (error instanceof Error) {
    return new ConvexError({
      code: error.message.startsWith("Missing `")
        ? "INVALID_PARAMETERS"
        : "INVALID_CREDENTIALS",
      message: error.message,
    });
  }
  return toConvexError(
    authFlowError("INTERNAL_ERROR", "Failed to authorize credentials."),
  );
};

export async function signInImpl(
  ctx: EnrichedActionCtx,
  provider: AuthProviderMaterializedConfig | null,
  args: {
    accountId?: GenericId<"Account">;
    params?: SignInParams;
    verifier?: string;
    refreshToken?: string;
    calledBy?: string;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
    resolveSsoProtocol?: (
      ctx: EnrichedActionCtx,
      connectionId: string,
    ) => Promise<"oidc" | "saml">;
  },
): Promise<SignInResult> {
  return signInFx(ctx, provider, args, options);
}

async function signInFx(
  ctx: EnrichedActionCtx,
  provider: AuthProviderMaterializedConfig | null,
  args: {
    accountId?: GenericId<"Account">;
    params?: SignInParams;
    verifier?: string;
    refreshToken?: string;
    calledBy?: string;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
    resolveSsoProtocol?: (
      ctx: EnrichedActionCtx,
      connectionId: string,
    ) => Promise<"oidc" | "saml">;
  },
): Promise<SignInResult> {
  return withSpan("convex-auth.signin", {
    hasProvider: provider !== null,
    hasCode: args.params?.code !== undefined,
    hasRefreshToken: args.refreshToken !== undefined,
  }, async () => {
    if (provider === null && args.refreshToken) {
      try {
        const tokens = await callRefreshSession(ctx, { refreshToken: args.refreshToken! });
        if (tokens === null) {
          return { kind: "signedIn" as const, signedIn: null };
        }
        return { kind: "refreshTokens" as const, signedIn: { tokens } };
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", "Failed to refresh session.");
      }
    }

    if (provider === null && args.params?.code !== undefined) {
      try {
        const result = await callVerifyCodeAndSignIn(ctx, {
          params: args.params as SignInParams,
          verifier: args.verifier,
          generateTokens: true,
          allowExtraProviders: options.allowExtraProviders,
        });
        return { kind: "signedIn" as const, signedIn: result };
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to verify sign-in code.",
        );
      }
    }

    const resolvedProvider = provider;
    if (resolvedProvider === null) {
      throw toConvexError(
        authFlowError(
          "SIGN_IN_MISSING_PARAMS",
          "Cannot sign in: missing provider, code, or refresh token.",
        ),
      );
    }

    const providerHandlers: Record<string, () => Promise<SignInResult>> = {
      email: () => handleEmailAndPhoneProviderFx(ctx, resolvedProvider as EmailConfig, args, options),
      phone: () => handleEmailAndPhoneProviderFx(ctx, resolvedProvider as PhoneConfig, args, options),
      credentials: () => handleCredentialsFx(ctx, resolvedProvider as ConvexCredentialsConfig, args, options),
      oauth: () => handleOAuthProviderFx(ctx, resolvedProvider as OAuthMaterializedConfig, args, options),
      passkey: () => handlePasskeyFx(ctx, resolvedProvider as any, args),
      totp: () => handleTotp(ctx, resolvedProvider as any, args),
      device: () => handleDevice(ctx, resolvedProvider as any, args),
      sso: () => handleSsoProviderFx(ctx, args, options),
    };

    const handler = providerHandlers[resolvedProvider.type];
    if (!handler) {
      throw toConvexError(
        authFlowError(
          "SIGN_IN_MISSING_PARAMS",
          `Unknown provider type: ${resolvedProvider.type}`,
        ),
      );
    }
    return handler();
  });
}

async function handleEmailAndPhoneProviderFx(
  ctx: EnrichedActionCtx,
  provider: EmailConfig | PhoneConfig,
  args: {
    params?: SignInParams;
    accountId?: GenericId<"Account">;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): Promise<
  | { kind: "started"; started: true }
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens }
> {
  return withSpan(`convex-auth.signin.${provider.type}`, {}, async () => {
    const normalizedParams = normalizeVerificationParams(args.params);
    if (args.params?.code !== undefined) {
      let result;
      try {
        result = await callVerifyCodeAndSignIn(ctx, {
          params: args.params as SignInParams,
          provider: provider.id,
          generateTokens: options.generateTokens,
          allowExtraProviders: options.allowExtraProviders,
        });
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to verify email or phone code.",
        );
      }
      if (result === null) {
        throw toConvexError(
          authFlowError(
            "INVALID_VERIFICATION_CODE",
            "Invalid or expired verification code.",
          ),
        );
      }
      return {
        kind: "signedIn" as const,
        signedIn: result as SessionInfoWithTokens,
      };
    }

    const alphabet =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let code: string;
    if (provider.generateVerificationToken) {
      try {
        code = await provider.generateVerificationToken();
      } catch {
        throw toConvexError(
          authFlowError(
            "INTERNAL_ERROR",
            "Failed to generate verification token",
          ),
        );
      }
    } else {
      code = generateRandomString(32, alphabet);
    }

    const expirationTime =
      Date.now() +
      (provider.maxAge ?? DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S) * 1000;

    let identifier: string;
    try {
      identifier = await callCreateVerificationCode(ctx, {
        provider: provider.id,
        accountId: args.accountId,
        email: normalizedParams.email,
        phone: normalizedParams.phone,
        code,
        expirationTime,
        allowExtraProviders: options.allowExtraProviders,
      });
    } catch (error) {
      throw asConvexError(
        error,
        "INTERNAL_ERROR",
        "Failed to create verification code.",
      );
    }

    let destination: string;
    try {
      destination = await redirectAbsoluteUrl(
        ctx.auth.config,
        (args.params ?? {}) as { redirectTo: unknown },
      );
    } catch (error) {
      throw asConvexError(
        error,
        "INVALID_REDIRECT",
        "Failed to resolve redirect URL.",
      );
    }

    const verificationArgs = {
      identifier,
      url: setURLSearchParam(destination, "code", code),
      token: code,
      expires: new Date(expirationTime),
    };

    if (provider.type === "email") {
      try {
        await (provider as EmailConfig).sendVerificationRequest(
          {
            ...verificationArgs,
            provider: provider as EmailConfig,
            request: new Request("http://localhost"),
          },
          ctx,
        );
      } catch {
        throw toConvexError(
          authFlowError("INTERNAL_ERROR", "Failed to send email code"),
        );
      }
    } else {
      try {
        await (provider as PhoneConfig).sendVerificationRequest(
          { ...verificationArgs, provider: provider as PhoneConfig },
          ctx,
        );
      } catch {
        throw toConvexError(
          authFlowError("INTERNAL_ERROR", "Failed to send phone code"),
        );
      }
    }

    return { kind: "started" as const, started: true as const };
  });
}

async function handleCredentialsFx(
  ctx: EnrichedActionCtx,
  provider: ConvexCredentialsConfig,
  args: {
    params?: SignInParams;
  },
  options: {
    generateTokens: boolean;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "totpRequired"; verifier: string }
> {
  return withSpan("convex-auth.signin.credentials", {}, async () => {
    let result;
    try {
      result = await provider.authorize(
        (args.params ?? {}) as Partial<Record<string, Value | undefined>>,
        ctx,
      );
    } catch (error) {
      throw asCredentialsError(error);
    }
    if (result === null) {
      return { kind: "signedIn" as const, signedIn: null };
    }

    let hasTotpEnrolled: boolean;
    try {
      const totpDoc = await queryTotpVerifiedByUserId(ctx, result.userId);
      hasTotpEnrolled = totpDoc !== null;
    } catch (error) {
      throw asConvexError(
        error,
        "INTERNAL_ERROR",
        "Failed to load TOTP enrollment.",
      );
    }

    if (hasTotpEnrolled) {
      try {
        await callSignIn(ctx, {
          userId: result.userId,
          sessionId: result.sessionId,
          generateTokens: false,
        });
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to start TOTP sign-in.",
        );
      }
      let verifier: string;
      try {
        verifier = await callVerifier(ctx, JSON.stringify({ userId: result.userId }));
      } catch (error) {
        throw asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier.");
      }
      return { kind: "totpRequired" as const, verifier };
    }

    let idsAndTokens;
    try {
      idsAndTokens = await callSignIn(ctx, {
        userId: result.userId,
        sessionId: result.sessionId,
        generateTokens: options.generateTokens,
      });
    } catch (error) {
      throw asConvexError(error, "INTERNAL_ERROR", "Failed to complete sign-in.");
    }
    return { kind: "signedIn" as const, signedIn: idsAndTokens };
  });
}

async function handleOAuthProviderFx(
  ctx: EnrichedActionCtx,
  provider: OAuthMaterializedConfig,
  args: {
    params?: SignInParams;
    verifier?: string;
  },
  options: {
    allowExtraProviders: boolean;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens | null }
  | { kind: "redirect"; redirect: string; verifier: string }
> {
  return withSpan(`convex-auth.signin.oauth`, { provider: provider.id }, async () => {
    if (args.params?.code !== undefined) {
      let result;
      try {
        result = await callVerifyCodeAndSignIn(ctx, {
          params: args.params as SignInParams,
          verifier: args.verifier,
          generateTokens: true,
          allowExtraProviders: options.allowExtraProviders,
        });
      } catch (error) {
        throw asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to verify OAuth sign-in.",
        );
      }
      return {
        kind: "signedIn" as const,
        signedIn: result as SessionInfoWithTokens | null,
      };
    }

    const redirect = new URL(
      (readConfigSync(envOptionalString("CUSTOM_AUTH_SITE_URL")) ??
        requireEnv("CONVEX_SITE_URL")) + `/api/auth/signin/${provider.id}`,
    );
    let verifier: string;
    try {
      verifier = await callVerifier(ctx);
    } catch (error) {
      throw asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier.");
    }
    redirect.searchParams.set("code", verifier);

    if (args.params?.redirectTo !== undefined) {
      if (typeof args.params.redirectTo !== "string") {
        throw toConvexError(
          authFlowError(
            "INVALID_REDIRECT",
            `Expected \`redirectTo\` to be a string, got ${describeUnknown(args.params.redirectTo)}`,
          ),
        );
      }
      redirect.searchParams.set("redirectTo", args.params.redirectTo);
    }

    return {
      kind: "redirect" as const,
      redirect: redirect.toString(),
      verifier,
    };
  });
}

async function handleSsoProviderFx(
  ctx: EnrichedActionCtx,
  args: {
    params?: SignInParams;
  },
  options: {
    resolveSsoProtocol?: (
      ctx: EnrichedActionCtx,
      connectionId: string,
    ) => Promise<"oidc" | "saml">;
  },
): Promise<{ kind: "redirect"; redirect: string; verifier: string }> {
  return withSpan("convex-auth.signin.sso", {}, async () => {
    const normalizedParams = normalizeVerificationParams(args.params);
    const connectionId = normalizedParams.connectionId;
    if (!connectionId || typeof connectionId !== "string") {
      throw toConvexError(
        authFlowError(
          "SIGN_IN_MISSING_PARAMS",
          "connectionId is required for SSO sign-in.",
        ),
      );
    }

    let protocol: "oidc" | "saml" =
      (normalizedParams.protocol === "oidc" ||
      normalizedParams.protocol === "saml"
        ? normalizedParams.protocol
        : undefined) ??
      (options.resolveSsoProtocol
        ? await (async () => {
            try {
              return await options.resolveSsoProtocol!(ctx, connectionId);
            } catch (error) {
              throw asConvexError(
                error,
                "INTERNAL_ERROR",
                "Failed to resolve SSO protocol.",
              );
            }
          })()
        : "oidc");

    log("DEBUG", "[group-sso] signin:resolved", {
      connectionId,
      protocol,
      redirectTo:
        typeof args.params?.redirectTo === "string"
          ? args.params.redirectTo
          : undefined,
    });

    if (protocol !== "oidc" && protocol !== "saml") {
      throw toConvexError(
        authFlowError(
          "SIGN_IN_MISSING_PARAMS",
          `Invalid SSO protocol: ${protocol as string}. Expected "oidc" or "saml".`,
        ),
      );
    }

    let verifier: string;
    try {
      verifier = await callVerifier(ctx);
    } catch (error) {
      throw asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier.");
    }
    const siteUrl =
      readConfigSync(envOptionalString("CUSTOM_AUTH_SITE_URL")) ??
      requireEnv("CONVEX_SITE_URL");
    const redirect = new URL(
      `${siteUrl}/api/auth/connections/${connectionId}/${protocol}/signin`,
    );
    redirect.searchParams.set("code", verifier);

    if (typeof args.params?.redirectTo === "string") {
      redirect.searchParams.set("redirectTo", args.params.redirectTo);
    }
    if (typeof normalizedParams.loginHint === "string") {
      redirect.searchParams.set("loginHint", normalizedParams.loginHint);
    }
    log("DEBUG", "[group-sso] signin:redirect", {
      connectionId,
      protocol,
      redirect: redirect.toString(),
    });

    return {
      kind: "redirect" as const,
      redirect: redirect.toString(),
      verifier,
    };
  });
}
