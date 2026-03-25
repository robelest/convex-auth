import type { Fx as FxType } from "@robelest/fx";
import { GenericId } from "convex/values";

import { handleDevice } from "./device";
import { AuthError, Fx } from "./fx";
import {
  callCreateVerificationCode,
  callRefreshSession,
  callSignIn,
  callVerifier,
  callVerifierSignature,
  callVerifyCodeAndSignIn,
} from "./mutations/index";
import { handlePasskeyFx } from "./passkey";
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
import { generateRandomString } from "./utils";
import { requireEnv } from "./utils";

const DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S = 60 * 60 * 24; // 24 hours

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

type SignInResult =
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "refreshTokens"; signedIn: { tokens: Tokens } }
  | { kind: "started"; started: true }
  | { kind: "redirect"; redirect: string; verifier: string }
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string }
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

/** @internal */
export async function signInImpl(
  ctx: EnrichedActionCtx,
  provider: AuthProviderMaterializedConfig | null,
  args: {
    accountId?: GenericId<"Account">;
    params?: Record<string, any>;
    verifier?: string;
    refreshToken?: string;
    calledBy?: string;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): Promise<SignInResult> {
  const fx = signInFx(ctx, provider, args, options);
  return Fx.run(
    fx.pipe(Fx.recover((e) => Fx.fatal((e as AuthError).toConvexError()))),
  );
}

/**
 * Core sign-in pipeline as an Fx generator.
 *
 * Handles: refresh tokens, verification codes, then dispatches by
 * provider type using a dispatch map (no if-chain).
 */
function signInFx(
  ctx: EnrichedActionCtx,
  provider: AuthProviderMaterializedConfig | null,
  args: {
    accountId?: GenericId<"Account">;
    params?: Record<string, any>;
    verifier?: string;
    refreshToken?: string;
    calledBy?: string;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): FxType<SignInResult, AuthError> {
  return Fx.gen(function* () {
    // --- Refresh token (no provider) ---
    if (provider === null && args.refreshToken) {
      const tokens = yield* Fx.promise(() =>
        callRefreshSession(ctx, { refreshToken: args.refreshToken! }),
      );
      if (tokens === null) {
        return { kind: "signedIn" as const, signedIn: null };
      }
      return { kind: "refreshTokens" as const, signedIn: { tokens } };
    }

    // --- Verify code (no provider, code present) ---
    if (provider === null && args.params?.code !== undefined) {
      const result = yield* Fx.promise(() =>
        callVerifyCodeAndSignIn(ctx, {
          params: args.params,
          verifier: args.verifier,
          generateTokens: true,
          allowExtraProviders: options.allowExtraProviders,
        }),
      );
      return { kind: "signedIn" as const, signedIn: result };
    }

    // --- Provider is required past this point ---
    const resolvedProvider = yield* provider != null
      ? Fx.succeed(provider)
      : Fx.fail(new AuthError("SIGN_IN_MISSING_PARAMS"));

    // --- Dispatch by provider type ---
    return yield* Fx.match(resolvedProvider).on("type", {
      email: (p) => handleEmailAndPhoneProviderFx(ctx, p, args, options),
      phone: (p) => handleEmailAndPhoneProviderFx(ctx, p, args, options),
      credentials: (p) => handleCredentialsFx(ctx, p, args, options),
      oauth: (p) => handleOAuthProviderFx(ctx, p, args, options),
      passkey: (p) => handlePasskeyFx(ctx, p, args),
      totp: (p) => handleTotp(ctx, p, args),
      device: (p) => handleDevice(ctx, p, args),
      sso: (_p) => handleSsoProviderFx(ctx, args),
    });
  });
}

// ============================================================================
// Email / Phone
// ============================================================================

function handleEmailAndPhoneProviderFx(
  ctx: EnrichedActionCtx,
  provider: EmailConfig | PhoneConfig,
  args: {
    params?: Record<string, any>;
    accountId?: GenericId<"Account">;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): FxType<
  | { kind: "started"; started: true }
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens },
  AuthError
> {
  return Fx.gen(function* () {
    // --- Code verification path ---
    if (args.params?.code !== undefined) {
      const result = yield* Fx.promise(() =>
        callVerifyCodeAndSignIn(ctx, {
          params: args.params,
          provider: provider.id,
          generateTokens: options.generateTokens,
          allowExtraProviders: options.allowExtraProviders,
        }),
      );
      const verified = yield* result != null
        ? Fx.succeed(result)
        : Fx.fail(new AuthError("INVALID_VERIFICATION_CODE"));
      return {
        kind: "signedIn" as const,
        signedIn: verified as SessionInfoWithTokens,
      };
    }

    // --- Send verification code path ---
    const alphabet =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const code = provider.generateVerificationToken
      ? yield* Fx.from({
          ok: async () => provider.generateVerificationToken!(),
          err: () =>
            new AuthError(
              "INTERNAL_ERROR",
              "Failed to generate verification token",
            ),
        })
      : generateRandomString(32, alphabet);
    const expirationTime =
      Date.now() +
      (provider.maxAge ?? DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S) * 1000;

    const identifier = yield* Fx.promise(() =>
      callCreateVerificationCode(ctx, {
        provider: provider.id,
        accountId: args.accountId,
        email: args.params?.email,
        phone: args.params?.phone,
        code,
        expirationTime,
        allowExtraProviders: options.allowExtraProviders,
      }),
    );
    const destination = yield* Fx.promise(() =>
      redirectAbsoluteUrl(
        ctx.auth.config,
        (args.params ?? {}) as { redirectTo: unknown },
      ),
    );
    const verificationArgs = {
      identifier,
      url: setURLSearchParam(destination, "code", code),
      token: code,
      expires: new Date(expirationTime),
    };
    yield* Fx.match(provider).on("type", {
      email: (p) =>
        Fx.from({
          ok: async () =>
            p.sendVerificationRequest(
              {
                ...verificationArgs,
                provider: p,
                request: new Request("http://localhost"),
              },
              ctx,
            ),
          err: () =>
            new AuthError("INTERNAL_ERROR", "Failed to send email code"),
        }),
      phone: (p) =>
        Fx.from({
          ok: async () =>
            p.sendVerificationRequest(
              { ...verificationArgs, provider: p },
              ctx,
            ),
          err: () =>
            new AuthError("INTERNAL_ERROR", "Failed to send phone code"),
        }),
    });
    return { kind: "started" as const, started: true as const };
  });
}

// ============================================================================
// Credentials
// ============================================================================

function handleCredentialsFx(
  ctx: EnrichedActionCtx,
  provider: ConvexCredentialsConfig,
  args: {
    params?: Record<string, any>;
  },
  options: {
    generateTokens: boolean;
  },
): FxType<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "totpRequired"; verifier: string },
  AuthError
> {
  return Fx.gen(function* () {
    const result = yield* Fx.promise(() =>
      provider.authorize(args.params ?? {}, ctx),
    );
    if (result === null) {
      return { kind: "signedIn" as const, signedIn: null };
    }

    // Check if user has TOTP 2FA enrolled before issuing tokens
    const hasTotpEnrolled = yield* Fx.promise(async () => {
      const totpDoc = await queryTotpVerifiedByUserId(ctx, result.userId);
      return totpDoc !== null;
    });
    if (hasTotpEnrolled) {
      // Create session but withhold tokens — TOTP verification needed
      yield* Fx.promise(() =>
        callSignIn(ctx, {
          userId: result.userId,
          sessionId: result.sessionId,
          generateTokens: false,
        }),
      );
      // Store userId in verifier so the TOTP verify flow can complete sign-in
      const verifier = yield* Fx.promise(() => callVerifier(ctx));
      yield* Fx.promise(() =>
        callVerifierSignature(ctx, {
          verifier,
          signature: JSON.stringify({ userId: result.userId }),
        }),
      );
      return { kind: "totpRequired" as const, verifier };
    }

    const idsAndTokens = yield* Fx.promise(() =>
      callSignIn(ctx, {
        userId: result.userId,
        sessionId: result.sessionId,
        generateTokens: options.generateTokens,
      }),
    );
    return { kind: "signedIn" as const, signedIn: idsAndTokens };
  });
}

// ============================================================================
// OAuth
// ============================================================================

function handleOAuthProviderFx(
  ctx: EnrichedActionCtx,
  provider: OAuthMaterializedConfig,
  args: {
    params?: Record<string, any>;
    verifier?: string;
  },
  options: {
    allowExtraProviders: boolean;
  },
): FxType<
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens | null }
  | { kind: "redirect"; redirect: string; verifier: string },
  AuthError
> {
  return Fx.gen(function* () {
    // --- Code verification path ---
    if (args.params?.code !== undefined) {
      const result = yield* Fx.promise(() =>
        callVerifyCodeAndSignIn(ctx, {
          params: args.params,
          verifier: args.verifier,
          generateTokens: true,
          allowExtraProviders: options.allowExtraProviders,
        }),
      );
      return {
        kind: "signedIn" as const,
        signedIn: result as SessionInfoWithTokens | null,
      };
    }

    // --- Build redirect URL ---
    const redirect = new URL(
      (process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL")) +
        `/api/auth/signin/${provider.id}`,
    );
    const verifier = yield* Fx.promise(() => callVerifier(ctx));
    redirect.searchParams.set("code", verifier);

    if (args.params?.redirectTo !== undefined) {
      yield* Fx.guard(
        typeof args.params.redirectTo !== "string",
        Fx.fail(
          new AuthError(
            "INVALID_REDIRECT",
            `Expected \`redirectTo\` to be a string, got ${args.params.redirectTo}`,
          ),
        ),
      );
      redirect.searchParams.set("redirectTo", args.params.redirectTo);
    }

    return {
      kind: "redirect" as const,
      redirect: redirect.toString(),
      verifier,
    };
  });
}

// ============================================================================
// SSO (Enterprise OIDC / SAML)
// ============================================================================

function handleSsoProviderFx(
  ctx: EnrichedActionCtx,
  args: {
    params?: Record<string, any>;
  },
): FxType<{ kind: "redirect"; redirect: string; verifier: string }, AuthError> {
  return Fx.gen(function* () {
    const enterpriseId = args.params?.enterpriseId;
    if (!enterpriseId || typeof enterpriseId !== "string") {
      return yield* Fx.fail(
        new AuthError(
          "SIGN_IN_MISSING_PARAMS",
          "enterpriseId is required for SSO sign-in.",
        ),
      );
    }

    const protocol: "oidc" | "saml" = args.params?.protocol ?? "oidc";
    if (protocol !== "oidc" && protocol !== "saml") {
      return yield* Fx.fail(
        new AuthError(
          "SIGN_IN_MISSING_PARAMS",
          `Invalid SSO protocol: ${protocol as string}. Expected "oidc" or "saml".`,
        ),
      );
    }

    const verifier = yield* Fx.promise(() => callVerifier(ctx));
    const siteUrl =
      process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL");
    const redirect = new URL(
      `${siteUrl}/api/auth/sso/${enterpriseId}/${protocol}/signin`,
    );
    redirect.searchParams.set("code", verifier);

    if (typeof args.params?.redirectTo === "string") {
      redirect.searchParams.set("redirectTo", args.params.redirectTo);
    }

    return {
      kind: "redirect" as const,
      redirect: redirect.toString(),
      verifier,
    };
  });
}
