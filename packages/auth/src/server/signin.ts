import { GenericId, ConvexError, type Value } from "convex/values";
import { Effect, Match } from "effect";

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
  callVerifierSignature,
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
  return Effect.runPromise(signInFx(ctx, provider, args, options));
}

function signInFx(
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
): Effect.Effect<SignInResult, ConvexError<AuthErrorData>> {
  return Effect.gen(function* () {
    if (provider === null && args.refreshToken) {
      const tokens = yield* Effect.tryPromise({
        try: () =>
          callRefreshSession(ctx, { refreshToken: args.refreshToken! }),
        catch: (error) =>
          asConvexError(error, "INTERNAL_ERROR", "Failed to refresh session."),
      });
      if (tokens === null) {
        return { kind: "signedIn" as const, signedIn: null };
      }
      return { kind: "refreshTokens" as const, signedIn: { tokens } };
    }

    if (provider === null && args.params?.code !== undefined) {
      const result = yield* Effect.tryPromise({
        try: () =>
          callVerifyCodeAndSignIn(ctx, {
            params: args.params as SignInParams,
            verifier: args.verifier,
            generateTokens: true,
            allowExtraProviders: options.allowExtraProviders,
          }),
        catch: (error) =>
          asConvexError(
            error,
            "INTERNAL_ERROR",
            "Failed to verify sign-in code.",
          ),
      });
      return { kind: "signedIn" as const, signedIn: result };
    }

    const resolvedProvider = provider;
    if (resolvedProvider === null) {
      return yield* Effect.fail(
        toConvexError(
          authFlowError(
            "SIGN_IN_MISSING_PARAMS",
            "Cannot sign in: missing provider, code, or refresh token.",
          ),
        ),
      );
    }

    return yield* Match.value(resolvedProvider).pipe(
      Match.when({ type: "email" }, (provider) =>
        handleEmailAndPhoneProviderFx(ctx, provider, args, options),
      ),
      Match.when({ type: "phone" }, (provider) =>
        handleEmailAndPhoneProviderFx(ctx, provider, args, options),
      ),
      Match.when({ type: "credentials" }, (provider) =>
        handleCredentialsFx(ctx, provider, args, options),
      ),
      Match.when({ type: "oauth" }, (provider) =>
        handleOAuthProviderFx(ctx, provider, args, options),
      ),
      Match.when({ type: "passkey" }, (provider) =>
        handlePasskeyFx(ctx, provider, args),
      ),
      Match.when({ type: "totp" }, (provider) =>
        handleTotp(ctx, provider, args),
      ),
      Match.when({ type: "device" }, (provider) =>
        handleDevice(ctx, provider, args),
      ),
      Match.when({ type: "sso" }, () =>
        handleSsoProviderFx(ctx, args, options),
      ),
      Match.exhaustive,
    );
  }).pipe(
    Effect.withSpan("convex-auth.signin", {
      attributes: {
        hasProvider: provider !== null,
        hasCode: args.params?.code !== undefined,
        hasRefreshToken: args.refreshToken !== undefined,
      },
    }),
  );
}

function handleEmailAndPhoneProviderFx(
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
): Effect.Effect<
  | { kind: "started"; started: true }
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens },
  ConvexError<AuthErrorData>
> {
  return Effect.gen(function* () {
    const normalizedParams = normalizeVerificationParams(args.params);
    if (args.params?.code !== undefined) {
      const result = yield* Effect.tryPromise({
        try: () =>
          callVerifyCodeAndSignIn(ctx, {
            params: args.params as SignInParams,
            provider: provider.id,
            generateTokens: options.generateTokens,
            allowExtraProviders: options.allowExtraProviders,
          }),
        catch: (error) =>
          asConvexError(
            error,
            "INTERNAL_ERROR",
            "Failed to verify email or phone code.",
          ),
      });
      if (result === null) {
        return yield* Effect.fail(
          toConvexError(
            authFlowError(
              "INVALID_VERIFICATION_CODE",
              "Invalid or expired verification code.",
            ),
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
    const code = provider.generateVerificationToken
      ? yield* Effect.tryPromise({
          try: async () => provider.generateVerificationToken!(),
          catch: () =>
            toConvexError(
              authFlowError(
                "INTERNAL_ERROR",
                "Failed to generate verification token",
              ),
            ),
        })
      : generateRandomString(32, alphabet);

    const expirationTime =
      Date.now() +
      (provider.maxAge ?? DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S) * 1000;

    const identifier = yield* Effect.tryPromise({
      try: () =>
        callCreateVerificationCode(ctx, {
          provider: provider.id,
          accountId: args.accountId,
          email: normalizedParams.email,
          phone: normalizedParams.phone,
          code,
          expirationTime,
          allowExtraProviders: options.allowExtraProviders,
        }),
      catch: (error) =>
        asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to create verification code.",
        ),
    });
    const destination = yield* Effect.tryPromise({
      try: () =>
        redirectAbsoluteUrl(
          ctx.auth.config,
          (args.params ?? {}) as { redirectTo: unknown },
        ),
      catch: (error) =>
        asConvexError(
          error,
          "INVALID_REDIRECT",
          "Failed to resolve redirect URL.",
        ),
    });
    const verificationArgs = {
      identifier,
      url: setURLSearchParam(destination, "code", code),
      token: code,
      expires: new Date(expirationTime),
    };

    yield* Match.value(provider).pipe(
      Match.when({ type: "email" }, (provider) =>
        Effect.tryPromise({
          try: async () => {
            await provider.sendVerificationRequest(
              {
                ...verificationArgs,
                provider,
                request: new Request("http://localhost"),
              },
              ctx,
            );
          },
          catch: () =>
            toConvexError(
              authFlowError("INTERNAL_ERROR", "Failed to send email code"),
            ),
        }),
      ),
      Match.when({ type: "phone" }, (provider) =>
        Effect.tryPromise({
          try: async () => {
            await provider.sendVerificationRequest(
              { ...verificationArgs, provider },
              ctx,
            );
          },
          catch: () =>
            toConvexError(
              authFlowError("INTERNAL_ERROR", "Failed to send phone code"),
            ),
        }),
      ),
      Match.exhaustive,
    );

    return { kind: "started" as const, started: true as const };
  }).pipe(Effect.withSpan(`convex-auth.signin.${provider.type}`));
}

function handleCredentialsFx(
  ctx: EnrichedActionCtx,
  provider: ConvexCredentialsConfig,
  args: {
    params?: SignInParams;
  },
  options: {
    generateTokens: boolean;
  },
): Effect.Effect<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "totpRequired"; verifier: string },
  ConvexError<AuthErrorData>
> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () =>
        provider.authorize(
          (args.params ?? {}) as Partial<Record<string, Value | undefined>>,
          ctx,
        ),
      catch: (error) => asCredentialsError(error),
    });
    if (result === null) {
      return { kind: "signedIn" as const, signedIn: null };
    }

    const hasTotpEnrolled = yield* Effect.tryPromise({
      try: async () => {
        const totpDoc = await queryTotpVerifiedByUserId(ctx, result.userId);
        return totpDoc !== null;
      },
      catch: (error) =>
        asConvexError(
          error,
          "INTERNAL_ERROR",
          "Failed to load TOTP enrollment.",
        ),
    });

    if (hasTotpEnrolled) {
      yield* Effect.tryPromise({
        try: () =>
          callSignIn(ctx, {
            userId: result.userId,
            sessionId: result.sessionId,
            generateTokens: false,
          }),
        catch: (error) =>
          asConvexError(
            error,
            "INTERNAL_ERROR",
            "Failed to start TOTP sign-in.",
          ),
      });
      const verifier = yield* Effect.tryPromise({
        try: () => callVerifier(ctx),
        catch: (error) =>
          asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier."),
      });
      yield* Effect.tryPromise({
        try: () =>
          callVerifierSignature(ctx, {
            verifier,
            signature: JSON.stringify({ userId: result.userId }),
          }),
        catch: (error) =>
          asConvexError(
            error,
            "INTERNAL_ERROR",
            "Failed to store verifier signature.",
          ),
      });
      return { kind: "totpRequired" as const, verifier };
    }

    const idsAndTokens = yield* Effect.tryPromise({
      try: () =>
        callSignIn(ctx, {
          userId: result.userId,
          sessionId: result.sessionId,
          generateTokens: options.generateTokens,
        }),
      catch: (error) =>
        asConvexError(error, "INTERNAL_ERROR", "Failed to complete sign-in."),
    });
    return { kind: "signedIn" as const, signedIn: idsAndTokens };
  }).pipe(Effect.withSpan("convex-auth.signin.credentials"));
}

function handleOAuthProviderFx(
  ctx: EnrichedActionCtx,
  provider: OAuthMaterializedConfig,
  args: {
    params?: SignInParams;
    verifier?: string;
  },
  options: {
    allowExtraProviders: boolean;
  },
): Effect.Effect<
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens | null }
  | { kind: "redirect"; redirect: string; verifier: string },
  ConvexError<AuthErrorData>
> {
  return Effect.gen(function* () {
    if (args.params?.code !== undefined) {
      const result = yield* Effect.tryPromise({
        try: () =>
          callVerifyCodeAndSignIn(ctx, {
            params: args.params as SignInParams,
            verifier: args.verifier,
            generateTokens: true,
            allowExtraProviders: options.allowExtraProviders,
          }),
        catch: (error) =>
          asConvexError(
            error,
            "INTERNAL_ERROR",
            "Failed to verify OAuth sign-in.",
          ),
      });
      return {
        kind: "signedIn" as const,
        signedIn: result as SessionInfoWithTokens | null,
      };
    }

    const redirect = new URL(
      (readConfigSync(envOptionalString("CUSTOM_AUTH_SITE_URL")) ??
        requireEnv("CONVEX_SITE_URL")) + `/api/auth/signin/${provider.id}`,
    );
    const verifier = yield* Effect.tryPromise({
      try: () => callVerifier(ctx),
      catch: (error) =>
        asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier."),
    });
    redirect.searchParams.set("code", verifier);

    if (args.params?.redirectTo !== undefined) {
      if (typeof args.params.redirectTo !== "string") {
        return yield* Effect.fail(
          toConvexError(
            authFlowError(
              "INVALID_REDIRECT",
              `Expected \`redirectTo\` to be a string, got ${describeUnknown(args.params.redirectTo)}`,
            ),
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
  }).pipe(
    Effect.withSpan(`convex-auth.signin.oauth`, {
      attributes: { provider: provider.id },
    }),
  );
}

function handleSsoProviderFx(
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
): Effect.Effect<
  { kind: "redirect"; redirect: string; verifier: string },
  ConvexError<AuthErrorData>
> {
  return Effect.gen(function* () {
    const normalizedParams = normalizeVerificationParams(args.params);
    const connectionId = normalizedParams.connectionId;
    if (!connectionId || typeof connectionId !== "string") {
      return yield* Effect.fail(
        toConvexError(
          authFlowError(
            "SIGN_IN_MISSING_PARAMS",
            "connectionId is required for SSO sign-in.",
          ),
        ),
      );
    }

    const protocol: "oidc" | "saml" =
      (normalizedParams.protocol === "oidc" ||
      normalizedParams.protocol === "saml"
        ? normalizedParams.protocol
        : undefined) ??
      (options.resolveSsoProtocol
        ? yield* Effect.tryPromise({
            try: () => options.resolveSsoProtocol!(ctx, connectionId),
            catch: (error) =>
              asConvexError(
                error,
                "INTERNAL_ERROR",
                "Failed to resolve SSO protocol.",
              ),
          })
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
      return yield* Effect.fail(
        toConvexError(
          authFlowError(
            "SIGN_IN_MISSING_PARAMS",
            `Invalid SSO protocol: ${protocol as string}. Expected "oidc" or "saml".`,
          ),
        ),
      );
    }

    const verifier = yield* Effect.tryPromise({
      try: () => callVerifier(ctx),
      catch: (error) =>
        asConvexError(error, "INTERNAL_ERROR", "Failed to create verifier."),
    });
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
  }).pipe(Effect.withSpan("convex-auth.signin.sso"));
}
