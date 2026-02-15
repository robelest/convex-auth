import { GenericId } from "convex/values";
import {
  AuthProviderMaterializedConfig,
  ConvexCredentialsConfig,
  EmailConfig,
  GenericActionCtxWithAuthConfig,
  PhoneConfig,
} from "../types";
import {
  AuthDataModel,
  SessionInfo,
  SessionInfoWithTokens,
  Tokens,
} from "./types";
import {
  callCreateVerificationCode,
  callRefreshSession,
  callSignIn,
  callVerifier,
  callVerifierSignature,
  callVerifyCodeAndSignIn,
} from "./mutations/index";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { requireEnv } from "../utils";
import type { OAuthMaterializedConfig } from "../types";
import { generateRandomString } from "./utils";
import { handlePasskey } from "./passkey";
import { handleTotp, checkTotpRequired } from "./totp";
import { handleDevice } from "./device";
import { throwAuthError } from "../errors";

const DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S = 60 * 60 * 24; // 24 hours

type EnrichedActionCtx = GenericActionCtxWithAuthConfig<AuthDataModel>;

export async function signInImpl(
  ctx: EnrichedActionCtx,
  provider: AuthProviderMaterializedConfig | null,
  args: {
    accountId?: GenericId<"account">;
    params?: Record<string, any>;
    verifier?: string;
    refreshToken?: string;
    calledBy?: string;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  // refresh tokens
  | { kind: "refreshTokens"; signedIn: { tokens: Tokens } }
  // Multi-step flows like magic link + OTP
  | { kind: "started"; started: true }
  // OAuth flows
  | { kind: "redirect"; redirect: string; verifier: string }
  // Passkey options (challenge + credential options)
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string }
  // TOTP 2FA required after credentials sign-in
  | { kind: "totpRequired"; verifier: string }
  // TOTP setup response (enrollment)
  | { kind: "totpSetup"; uri: string; secret: string; verifier: string; totpId: string }
  // Device authorization (RFC 8628) — codes for the device to display
  | {
      kind: "deviceCode";
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    }
> {
  if (provider === null && args.refreshToken) {
    const tokens = await callRefreshSession(ctx, {
      refreshToken: args.refreshToken,
    });
    if (tokens === null) {
      return { kind: "signedIn", signedIn: null };
    }
    return { kind: "refreshTokens", signedIn: { tokens } };
  }
  if (provider === null && args.params?.code !== undefined) {
    const result = await callVerifyCodeAndSignIn(ctx, {
      params: args.params,
      verifier: args.verifier,
      generateTokens: true,
      allowExtraProviders: options.allowExtraProviders,
    });
    return {
      kind: "signedIn",
      signedIn: result,
    };
  }

  if (provider === null) {
    throwAuthError("SIGN_IN_MISSING_PARAMS");
  }
  if (provider.type === "email" || provider.type === "phone") {
    return handleEmailAndPhoneProvider(ctx, provider, args, options);
  }
  if (provider.type === "credentials") {
    return handleCredentials(ctx, provider, args, options);
  }
  if (provider.type === "oauth") {
    return handleOAuthProvider(ctx, provider, args, options);
  }
  if (provider.type === "passkey") {
    return handlePasskey(ctx, provider, args);
  }
  if (provider.type === "totp") {
    return handleTotp(ctx, provider, args);
  }
  if (provider.type === "device") {
    return handleDevice(ctx, provider, args);
  }
  const _typecheck: never = provider;
  throwAuthError(
    "UNSUPPORTED_PROVIDER_TYPE",
    `Provider type ${(provider as any).type} is not supported yet`,
  );
}

async function handleEmailAndPhoneProvider(
  ctx: EnrichedActionCtx,
  provider: EmailConfig | PhoneConfig,
  args: {
    params?: Record<string, any>;
    accountId?: GenericId<"account">;
  },
  options: {
    generateTokens: boolean;
    allowExtraProviders: boolean;
  },
): Promise<
  | { kind: "started"; started: true }
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens }
> {
  if (args.params?.code !== undefined) {
    const result = await callVerifyCodeAndSignIn(ctx, {
      params: args.params,
      provider: provider.id,
      generateTokens: options.generateTokens,
      allowExtraProviders: options.allowExtraProviders,
    });
    if (result === null) {
      throwAuthError("INVALID_VERIFICATION_CODE");
    }
    return {
      kind: "signedIn",
      signedIn: result as SessionInfoWithTokens,
    };
  }

  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const code = provider.generateVerificationToken
    ? await provider.generateVerificationToken()
    : generateRandomString(32, alphabet);
  const expirationTime =
    Date.now() +
    (provider.maxAge ?? DEFAULT_EMAIL_VERIFICATION_CODE_DURATION_S) * 1000;

  const identifier = await callCreateVerificationCode(ctx, {
    provider: provider.id,
    accountId: args.accountId,
    email: args.params?.email,
    phone: args.params?.phone,
    code,
    expirationTime,
    allowExtraProviders: options.allowExtraProviders,
  });
  const destination = await redirectAbsoluteUrl(
    ctx.auth.config,
    (args.params ?? {}) as { redirectTo: unknown },
  );
  const verificationArgs = {
    identifier,
    url: setURLSearchParam(destination, "code", code),
    token: code,
    expires: new Date(expirationTime),
  };
  if (provider.type === "email") {
    await provider.sendVerificationRequest(
      {
        ...verificationArgs,
        provider,
        request: new Request("http://localhost"),
      },
      ctx,
    );
  } else if (provider.type === "phone") {
    await provider.sendVerificationRequest(
      { ...verificationArgs, provider },
      ctx,
    );
  }
  return { kind: "started", started: true };
}

async function handleCredentials(
  ctx: EnrichedActionCtx,
  provider: ConvexCredentialsConfig,
  args: {
    params?: Record<string, any>;
  },
  options: {
    generateTokens: boolean;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfo | null }
  | { kind: "totpRequired"; verifier: string }
> {
  const result = await provider.authorize(args.params ?? {}, ctx);
  if (result === null) {
    return { kind: "signedIn", signedIn: null };
  }
  // Check if user has TOTP 2FA enrolled before issuing tokens
  const hasTotpEnrolled = await checkTotpRequired(ctx, result.userId);
  if (hasTotpEnrolled) {
    // Create session but withhold tokens — TOTP verification needed
    await callSignIn(ctx, {
      userId: result.userId,
      sessionId: result.sessionId,
      generateTokens: false,
    });
    // Store userId in verifier so the TOTP verify flow can complete sign-in
    const verifier = await callVerifier(ctx);
    await callVerifierSignature(ctx, {
      verifier,
      signature: JSON.stringify({ userId: result.userId }),
    });
    return { kind: "totpRequired", verifier };
  }

  const idsAndTokens = await callSignIn(ctx, {
    userId: result.userId,
    sessionId: result.sessionId,
    generateTokens: options.generateTokens,
  });
  return {
    kind: "signedIn",
    signedIn: idsAndTokens,
  };
}

async function handleOAuthProvider(
  ctx: EnrichedActionCtx,
  provider: OAuthMaterializedConfig,
  args: {
    params?: Record<string, any>;
    verifier?: string;
  },
  options: {
    allowExtraProviders: boolean;
  },
): Promise<
  | { kind: "signedIn"; signedIn: SessionInfoWithTokens | null }
  | { kind: "redirect"; redirect: string; verifier: string }
> {
  // We have this action because:
  // 1. We remember the current sessionId if any, so we can link accounts
  // 2. The client doesn't need to know the HTTP Actions URL
  //    of the backend (this simplifies using local backend)
  // 3. The client doesn't need to know which provider is of which type,
  //    and hence which provider requires client-side redirect
  // 4. On mobile the client can complete the flow manually
  if (args.params?.code !== undefined) {
    const result = await callVerifyCodeAndSignIn(ctx, {
      params: args.params,
      verifier: args.verifier,
      generateTokens: true,
      allowExtraProviders: options.allowExtraProviders,
    });
    return {
      kind: "signedIn",
      signedIn: result as SessionInfoWithTokens | null,
    };
  }
  const redirect = new URL(
    (process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL")) + `/api/auth/signin/${provider.id}`,
  );
  const verifier = await callVerifier(ctx);
  redirect.searchParams.set("code", verifier);
  if (args.params?.redirectTo !== undefined) {
    if (typeof args.params.redirectTo !== "string") {
      throwAuthError(
        "INVALID_REDIRECT",
        `Expected \`redirectTo\` to be a string, got ${args.params.redirectTo}`,
      );
    }
    redirect.searchParams.set("redirectTo", args.params.redirectTo);
  }
  return { kind: "redirect", redirect: redirect.toString(), verifier };
}
