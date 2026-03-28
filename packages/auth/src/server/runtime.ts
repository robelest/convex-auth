import { Fx } from "@robelest/fx";
import { Cv } from "@robelest/fx/convex";
import {
  GenericActionCtx,
  GenericDataModel,
  HttpRouter,
  actionGeneric,
  internalMutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { serialize as serializeCookie } from "cookie";

import { configDefaults, listAvailableProviders } from "./config";
import { redirectToParamCookie, useRedirectToParam } from "./cookies";
import { createCoreDomains } from "./core";
import { GetProviderOrThrowFunc } from "./crypto";
import {
  getOidcConfig,
  getPublicOidcConfig,
  getSamlConfig,
  upsertProtocolConfig,
  withOidcSecretState,
} from "./enterprise/config";
import { createEnterpriseDomain } from "./enterprise/domain";
import { addEnterpriseHttpRuntime } from "./enterprise/http";
import {
  normalizeEnterprisePolicy,
  patchEnterprisePolicy,
} from "./enterprise/policy";
import {
  createServiceProviderMetadata,
  getSamlServiceProviderOptions,
  parseSamlIdpMetadata,
} from "./enterprise/saml";
import { parseScimPath } from "./enterprise/scim";
import {
  enterpriseOidcProviderId,
  getEnterpriseOidcUrls,
  isEnterpriseSamlSourceActive,
  normalizeDomain,
} from "./enterprise/shared";
import {
  addAuthRoutes,
  addOpenIdRoutes,
  convertErrorsToResponse,
  createHttpAction,
  createHttpContext,
  createHttpRoute,
  getCookies,
} from "./http";
import {
  callCreateAccountFromCredentials,
  callInvalidateSessions,
  callModifyAccount,
  callRetrieveAccountWithCredentials,
  callSignOut,
  callUserOAuth,
  callVerifierSignature,
  storeArgs,
  storeImpl,
} from "./mutations/index";
import { createOAuthAuthorizationURL, handleOAuthCallback } from "./oauth";
import { redirectAbsoluteUrl, setURLSearchParam } from "./redirects";
import { signInImpl } from "./signin";
import type {
  ConvexAuthConfig,
  FunctionReferenceFromExport,
  OAuthMaterializedConfig,
  Tokens,
} from "./types";
import { MutationCtx } from "./types";
import {
  decryptSecret,
  encryptSecret,
  generateRandomString,
  LOG_LEVELS,
  logError,
  logWithLevel,
  sha256,
} from "./utils";
import { requireEnv } from "./utils";

const ENTERPRISE_OIDC_CLIENT_SECRET_KIND = "oidc_client_secret" as const;

/**
 * The type of the signIn Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
 */
export type SignInAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signIn"]
>;

/** @internal */
export type SignInActionResult =
  | { kind: "signedIn"; tokens: Tokens | null }
  | { kind: "redirect"; redirect: string; verifier: string }
  | { kind: "started" }
  | { kind: "passkeyOptions"; options: Record<string, any>; verifier: string }
  | { kind: "totpRequired"; verifier: string }
  | {
      kind: "totpSetup";
      totpSetup: { uri: string; secret: string; totpId: string };
      verifier: string;
    }
  | {
      kind: "deviceCode";
      deviceCode: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        verificationUriComplete: string;
        expiresIn: number;
        interval: number;
      };
    };
/**
 * The type of the signOut Convex Action returned from the auth() helper.
 *
 * This type is exported for implementors of other client integrations.
 * However it is not stable, and may change until this library reaches 1.0.
 *
 * @internal
 */
export type SignOutAction = FunctionReferenceFromExport<
  ReturnType<typeof Auth>["signOut"]
>;

/**
 * Configure the Convex Auth library. Returns an object with
 * functions and `auth` helper. You must export the functions
 * from `convex/auth.ts` to make them callable:
 *
 * ```ts filename="convex/auth.ts"
 * import { createAuth } from "@robelest/convex-auth/component";
 * import { components } from "./_generated/api";
 *
 * export const auth = createAuth(components.auth, {
 *   providers: [],
 * });
 * export const { signIn, signOut, store } = auth;
 * ```
 *
 * @returns An object with fields you should reexport from your
 *          `convex/auth.ts` file.
 */
export function Auth(config_: ConvexAuthConfig) {
  const config = configDefaults(config_);
  const hasOAuth = config.providers.some(
    (provider) => provider.type === "oauth",
  );
  const hasSSO = config.providers.some((provider) => provider.type === "sso");
  const getProviderOrThrow: GetProviderOrThrowFunc = (
    id: string,
    allowExtraProviders: boolean = false,
  ) => {
    const provider =
      config.providers.find(
        (configuredProvider) => configuredProvider.id === id,
      ) ??
      (allowExtraProviders
        ? config.extraProviders.find(
            (configuredProvider) => configuredProvider.id === id,
          )
        : undefined);
    if (provider === undefined) {
      const detail =
        `Provider \`${id}\` is not configured, ` +
        `available providers are ${listAvailableProviders(config, allowExtraProviders)}.`;
      logWithLevel(LOG_LEVELS.ERROR, detail);
      throw Cv.error({
        code: "PROVIDER_NOT_CONFIGURED",
        message: detail,
        provider: id,
      });
    }
    return provider;
  };
  type ComponentCtx = Pick<
    GenericActionCtx<GenericDataModel>,
    "runQuery" | "runMutation"
  >;
  type ComponentReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
  const getEnterpriseSecret = async (
    ctx: ComponentReadCtx | ComponentCtx,
    enterpriseId: string,
    kind: typeof ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
  ) => {
    return await ctx.runQuery(config.component.public.enterpriseSecretGet, {
      enterpriseId,
      kind,
    });
  };
  const getEnterpriseOidcConfigWithSecret = async (
    ctx: ComponentReadCtx | ComponentCtx,
    enterprise: { _id: string; config?: unknown },
  ): Promise<Record<string, any>> => {
    const oidc = getOidcConfig(enterprise.config);
    const secret = await getEnterpriseSecret(
      ctx,
      enterprise._id,
      ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
    );
    return {
      ...oidc,
      ...(secret
        ? { clientSecret: await decryptSecret(secret.ciphertext) }
        : {}),
    };
  };
  const INVITE_TOKEN_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const INVITE_TOKEN_LENGTH = 48;

  const enterpriseNotFoundError = "Enterprise not found.";

  const ENTERPRISE_CONTROL_ROUTE_BASE = "/api/auth/sso";

  const getPolicyFromEnterprise = (enterprise: { policy?: unknown }) =>
    normalizeEnterprisePolicy(enterprise.policy);

  const loadEnterpriseOrThrow = async (
    ctx: ComponentReadCtx,
    enterpriseId: string,
  ) => {
    const enterprise = await ctx.runQuery(
      config.component.public.enterpriseGet,
      {
        enterpriseId,
      },
    );
    if (!enterprise) {
      throw Cv.error({
        code: "INVALID_PARAMETERS",
        message: enterpriseNotFoundError,
      });
    }
    return enterprise;
  };

  const loadActiveEnterpriseOrThrow = async (
    ctx: ComponentReadCtx,
    enterpriseId: string,
  ) => {
    const enterprise = await loadEnterpriseOrThrow(ctx, enterpriseId);
    if (enterprise.status !== "active") {
      throw Cv.error({
        code: "INVALID_PARAMETERS",
        message: "Enterprise connection is not active.",
      });
    }
    return enterprise;
  };

  const loadActiveEnterpriseSamlOrThrow = async (
    ctx: ComponentReadCtx,
    enterpriseId: string,
  ) => {
    const enterprise = await loadEnterpriseOrThrow(ctx, enterpriseId);
    const loaded = {
      source: {
        kind: "enterprise" as const,
        id: enterpriseId,
      },
      config: enterprise.config,
      status: enterprise.status,
      enterprise,
    };
    if (!isEnterpriseSamlSourceActive(loaded)) {
      throw Cv.error({
        code: "INVALID_PARAMETERS",
        message: "Enterprise connection is not active.",
      });
    }
    const saml = getSamlConfig(loaded.config);
    if (!saml.idp?.metadataXml) {
      throw Cv.error({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "SAML is not configured for this enterprise.",
      });
    }
    return { loaded, enterprise, saml };
  };

  const loadEnterpriseOidcOrThrow = async (
    ctx: ComponentReadCtx,
    enterpriseId: string,
  ) => {
    const enterprise = await loadActiveEnterpriseOrThrow(ctx, enterpriseId);
    const oidc = await getEnterpriseOidcConfigWithSecret(ctx, enterprise);
    if (oidc.enabled !== true) {
      throw Cv.error({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "OIDC is not configured for this enterprise.",
      });
    }
    return { enterprise, oidc };
  };

  const validateEnterprisePolicy = (
    policy: ReturnType<typeof normalizeEnterprisePolicy>,
  ) => {
    const checks: Array<{
      name: string;
      ok: boolean;
      message?: string;
    }> = [];

    checks.push({ name: "policy_version", ok: policy.version === 1 });
    checks.push({
      name: "jit_default_role_ids_present",
      ok:
        policy.provisioning.jit.mode !== "createUserAndMembership" ||
        policy.provisioning.jit.defaultRoleIds.length > 0,
      message:
        policy.provisioning.jit.mode === "createUserAndMembership" &&
        policy.provisioning.jit.defaultRoleIds.length === 0
          ? "At least one default roleId is required when JIT membership provisioning is enabled."
          : undefined,
    });
    checks.push({
      name: "jit_default_role_ids_known",
      ok: policy.provisioning.jit.defaultRoleIds.every(
        (roleId) => config.authorization.roles[roleId] !== undefined,
      ),
      message: policy.provisioning.jit.defaultRoleIds.every(
        (roleId) => config.authorization.roles[roleId] !== undefined,
      )
        ? undefined
        : "JIT defaultRoleIds contains unknown roleIds.",
    });
    checks.push({
      name: "scim_reuse_supported",
      ok:
        policy.provisioning.scimReuse.user === "externalId" ||
        policy.provisioning.scimReuse.user === "none",
    });

    return checks;
  };

  const recordEnterpriseAuditEvent = async (
    ctx: ComponentCtx,
    data: {
      enterpriseId: string;
      groupId: string;
      eventType: string;
      actorType: "user" | "system" | "scim" | "api_key" | "webhook";
      actorId?: string;
      subjectType: string;
      subjectId?: string;
      ok: boolean;
      requestId?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    const { ok, ...rest } = data;
    return (await ctx.runMutation(
      config.component.public.enterpriseAuditEventCreate,
      {
        ...rest,
        status: ok ? "success" : "failure",
        occurredAt: Date.now(),
      },
    )) as string;
  };

  const emitEnterpriseWebhookDeliveries = async (
    ctx: ComponentCtx,
    data: {
      enterpriseId: string;
      eventType: string;
      payload: Record<string, unknown>;
      auditEventId?: string;
    },
  ) => {
    const endpoints = await ctx.runQuery(
      config.component.public.enterpriseWebhookEndpointList,
      { enterpriseId: data.enterpriseId },
    );
    for (const endpoint of endpoints) {
      if (
        endpoint.status !== "active" ||
        !endpoint.subscriptions.includes(data.eventType)
      ) {
        continue;
      }
      await ctx.runMutation(
        config.component.public.enterpriseWebhookDeliveryEnqueue,
        {
          enterpriseId: data.enterpriseId,
          endpointId: endpoint._id,
          auditEventId: data.auditEventId,
          eventType: data.eventType,
          payload: data.payload,
          nextAttemptAt: Date.now(),
        },
      );
    }
  };

  const getEnterpriseScimContext = async (
    ctx: ComponentReadCtx,
    request: Request,
  ) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw Cv.error({
        code: "MISSING_BEARER_TOKEN",
        message: "Missing or malformed Authorization: Bearer header.",
      });
    }
    const token = authHeader.slice(7);
    const scimConfig = await ctx.runQuery(
      config.component.public.enterpriseScimConfigGetByTokenHash,
      { tokenHash: await sha256(token) },
    );
    if (!scimConfig || scimConfig.status !== "active") {
      throw Cv.error({
        code: "INVALID_API_KEY",
        message: "Invalid SCIM token.",
      });
    }
    const parsedPath = parseScimPath(new URL(request.url).pathname);
    if (parsedPath.enterpriseId !== scimConfig.enterpriseId) {
      throw Cv.error({
        code: "INVALID_API_KEY",
        message: "SCIM token/tenant mismatch.",
      });
    }
    const enterprise = await ctx.runQuery(
      config.component.public.enterpriseGet,
      {
        enterpriseId: scimConfig.enterpriseId,
      },
    );
    if (enterprise === null) {
      throw Cv.error({
        code: "INVALID_PARAMETERS",
        message: "Enterprise not found.",
      });
    }
    return { scimConfig, enterprise, parsedPath };
  };

  let auth: any;
  auth = {
    ...createCoreDomains({
      config,
      getAuth: () => auth,
      callInvalidateSessions,
      callCreateAccountFromCredentials,
      callRetrieveAccountWithCredentials,
      callModifyAccount,
      getEnrichCtx: () => enrichCtx,
      inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
      inviteTokenLength: INVITE_TOKEN_LENGTH,
    }),
    /**
     * SSO namespace — enterprise SSO connection management, domain, OIDC,
     * SAML, SCIM, audit, and webhook helpers.
     */
    sso: createEnterpriseDomain({
      config,
      getAuth: () => auth,
      normalizeEnterprisePolicy,
      normalizeDomain,
      getEnterpriseSecret,
      loadEnterpriseOrThrow,
      validateEnterprisePolicy,
      recordEnterpriseAuditEvent,
      emitEnterpriseWebhookDeliveries,
      enterpriseNotFoundError,
      ENTERPRISE_OIDC_CLIENT_SECRET_KIND,
      requireEnv,
      generateRandomString,
      INVITE_TOKEN_ALPHABET,
      sha256,
      encryptSecret,
      upsertProtocolConfig,
      parseSamlIdpMetadata,
      createServiceProviderMetadata,
      getSamlServiceProviderOptions,
      getPublicOidcConfig,
      withOidcSecretState,
      getOidcConfig,
      getEnterpriseOidcUrls,
      enterpriseOidcProviderId,
      getPolicyFromEnterprise,
      patchEnterprisePolicy,
    }),
  };

  // HTTP wiring stays local to the factory because it still depends on a
  // dense mix of OAuth, SAML, SCIM, cookie, and response helpers.
  auth.http = {
    /**
     * Register core HTTP routes for JWT verification and OAuth sign-in.
     *
     * ```ts
     * import { httpRouter } from "convex/server";
     * import { auth } from "./auth";
     *
     * const http = httpRouter();
     *
     * auth.http.add(http);
     *
     * export default http;
     * ```
     *
     * The following routes are handled always:
     *
     * - `/.well-known/openid-configuration`
     * - `/.well-known/jwks.json`
     *
     * The following routes are handled if OAuth is configured:
     *
     * - `/api/auth/signin/*`
     * - `/api/auth/callback/*`
     *
     * @param http your HTTP router
     */
    add: (http: HttpRouter) => {
      addOpenIdRoutes(http, {
        getIssuer: () => requireEnv("CONVEX_SITE_URL"),
        getJwks: () => requireEnv("JWKS"),
      });

      addEnterpriseHttpRuntime({
        http,
        hasSSO,
        auth,
        config,
        routeBase: ENTERPRISE_CONTROL_ROUTE_BASE,
        requireEnv,
        loadActiveEnterpriseSamlOrThrow,
        loadEnterpriseOidcOrThrow,
        getEnterpriseScimContext,
        getPolicyFromEnterprise,
        normalizeEnterprisePolicy,
        recordEnterpriseAuditEvent,
        emitEnterpriseWebhookDeliveries,
        generateRandomString,
        inviteTokenAlphabet: INVITE_TOKEN_ALPHABET,
        callUserOAuth,
        callVerifierSignature,
      });

      if (hasOAuth) {
        addAuthRoutes(http, {
          handleSignIn: convertErrorsToResponse(400, async (ctx, request) => {
            const url = new URL(request.url);
            const pathParts = url.pathname.split("/");
            const providerId = pathParts[pathParts.length - 1]!;
            if (providerId === null) {
              throw Cv.error({
                code: "OAUTH_MISSING_PROVIDER",
                message: "Missing OAuth provider ID.",
              });
            }
            const verifier = url.searchParams.get("code");
            if (verifier === null) {
              throw Cv.error({
                code: "OAUTH_MISSING_VERIFIER",
                message: "Missing sign-in verifier.",
              });
            }
            const provider = getProviderOrThrow(providerId);

            const oauthConfig = provider as OAuthMaterializedConfig;
            const { redirect, cookies, signature } =
              await createOAuthAuthorizationURL(
                providerId,
                oauthConfig.provider,
                oauthConfig,
              );

            await callVerifierSignature(ctx, {
              verifier,
              signature,
            });

            const redirectTo = url.searchParams.get("redirectTo");
            if (redirectTo !== null) {
              cookies.push(redirectToParamCookie(providerId, redirectTo));
            }

            const headers = new Headers({ Location: redirect });
            for (const { name, value, options } of cookies) {
              headers.append(
                "Set-Cookie",
                serializeCookie(name, value, options as any),
              );
            }

            return new Response(null, { status: 302, headers });
          }),
          handleCallback: async (ctx, request) => {
            const url = new URL(request.url);
            const callbackPathParts = new URL(request.url).pathname.split("/");
            const providerId = callbackPathParts[callbackPathParts.length - 1];
            if (!providerId) {
              throw Cv.error({
                code: "OAUTH_MISSING_PROVIDER",
                message: "Missing OAuth provider ID.",
              });
            }
            logWithLevel(
              LOG_LEVELS.DEBUG,
              "Handling OAuth callback for provider:",
              providerId,
            );
            const provider = getProviderOrThrow(providerId);

            const cookies = getCookies(request);

            const maybeRedirectTo = useRedirectToParam(provider.id, cookies);

            const destinationUrl = await redirectAbsoluteUrl(config, {
              redirectTo: maybeRedirectTo?.redirectTo,
            });

            const params = url.searchParams;

            if (
              request.headers.get("Content-Type") ===
              "application/x-www-form-urlencoded"
            ) {
              const formData = await request.formData();
              formData.forEach((value, key) => {
                if (typeof value === "string") {
                  params.append(key, value);
                }
              });
            }

            return Fx.run(
              Fx.from({
                ok: async () => {
                  const oauthConfig = provider as OAuthMaterializedConfig;
                  const result = await Fx.run(
                    handleOAuthCallback(
                      providerId,
                      oauthConfig.provider,
                      oauthConfig,
                      Object.fromEntries(params.entries()),
                      cookies,
                    ),
                  );
                  const oauthCookies = result.cookies;
                  const { id: profileId, ...profileData } = result.profile;
                  const { signature } = result;

                  const verificationCode = await callUserOAuth(ctx, {
                    provider: providerId,
                    providerAccountId: profileId,
                    profile: profileData,
                    signature,
                  });

                  const redirUrl = setURLSearchParam(
                    destinationUrl,
                    "code",
                    verificationCode,
                  );
                  const redirHeaders = new Headers({ Location: redirUrl });
                  redirHeaders.set("Cache-Control", "must-revalidate");
                  for (const { name, value, options } of [
                    ...oauthCookies,
                    ...(maybeRedirectTo !== null
                      ? [maybeRedirectTo.updatedCookie]
                      : []),
                  ] as any) {
                    redirHeaders.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return new Response(null, {
                    status: 302,
                    headers: redirHeaders,
                  });
                },
                err: (error) => error,
              }).pipe(
                Fx.recover((error) => {
                  logError(error);
                  const respHeaders = new Headers({
                    Location: destinationUrl,
                  });
                  for (const { name, value, options } of maybeRedirectTo !== null
                    ? [maybeRedirectTo.updatedCookie]
                    : []) {
                    respHeaders.append(
                      "Set-Cookie",
                      serializeCookie(name, value, options),
                    );
                  }
                  return Fx.succeed(
                    new Response(null, {
                      status: 302,
                      headers: respHeaders,
                    }),
                  );
                }),
              ),
            );
          },
        });
      }
    },

    /**
     * Resolve mixed HTTP auth for a raw `httpAction`.
     *
     * Checks session auth first, then falls back to `Authorization: Bearer sk_*`
     * API keys. This is the low-level helper for endpoints that intentionally
     * accept either browser sessions or API keys.
     * Pass `{ optional: true }` to get a null-shaped auth object instead of a
     * `NOT_SIGNED_IN` error.
     *
     * ```ts
     * http.route({
     *   path: "/api/data",
     *   method: "GET",
     *   handler: httpAction(async (ctx, request) => {
     *     const authContext = await auth.http.context(ctx, request);
     *     return Response.json({
     *       userId: authContext.userId,
     *       source: authContext.source,
     *     });
     *   }),
     * });
     * ```
     */
    context: createHttpContext(auth),

    /**
     * Wrap an HTTP action handler with Bearer token authentication.
     *
     * Extracts the `Authorization: Bearer <key>` header, verifies the
     * API key via `auth.key.verify()`, and injects `ctx.key` with the
     * verified key info. Returns structured JSON error responses for
     * missing/invalid/revoked/expired/rate-limited keys.
     *
     * If the handler returns a plain object, it is auto-wrapped in a
     * `200 JSON` response. If it returns a `Response`, CORS headers
     * are merged and the response is passed through.
     *
     * ```ts
     * const handler = auth.http.action(async (ctx, request) => {
     *   const data = await ctx.runQuery(api.data.get, { userId: ctx.key.userId });
     *   return { data };
     * });
     * http.route({ path: "/api/data", method: "GET", handler });
     * ```
     *
     * @param handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
     * @param options.scope - Optional scope check; returns 403 if the key lacks permission.
     * @param options.cors - CORS config; defaults to permissive (`*`).
     */
    action: createHttpAction(auth),

    /**
     * Register a Bearer-authenticated route **and** its OPTIONS preflight
     * in a single call.
     *
     * ```ts
     * auth.http.route(http, {
     *   path: "/api/messages",
     *   method: "POST",
     *   handler: async (ctx, request) => {
     *     const { body } = await request.json();
     *     await ctx.runMutation(internal.messages.sendAsUser, {
     *       userId: ctx.key.userId,
     *       body,
     *     });
     *     return { success: true };
     *   },
     * });
     * ```
     *
     * @param http - The Convex HTTP router.
     * @param routeConfig.path - The URL path to match.
     * @param routeConfig.method - HTTP method (GET, POST, PUT, PATCH, DELETE).
     * @param routeConfig.handler - Receives enriched `ctx` (with `ctx.key`) and the raw `Request`.
     * @param routeConfig.scope - Optional scope check; returns 403 if the key lacks permission.
     * @param routeConfig.cors - CORS config; defaults to permissive (`*`).
     */
    route: createHttpRoute(createHttpAction(auth)),
  };

  const enrichCtx = <DataModel extends GenericDataModel>(
    ctx: GenericActionCtx<DataModel>,
  ) => ({
    ...ctx,
    auth: {
      ...ctx.auth,
      config,
      account: auth.account,
      session: auth.session,
      member: auth.member,
      provider: auth.provider,
    },
  });

  return {
    /**
     * Helper for configuring HTTP actions.
     */
    auth,
    /**
     * Action called by the client to sign the user in.
     *
     * Also used for refreshing the session.
     */
    signIn: actionGeneric({
      args: {
        provider: v.optional(v.string()),
        params: v.optional(v.any()),
        verifier: v.optional(v.string()),
        refreshToken: v.optional(v.string()),
        calledBy: v.optional(v.string()),
      },
      handler: async (ctx, args): Promise<SignInActionResult> => {
        if (args.calledBy !== undefined) {
          logWithLevel("INFO", `\`auth:signIn\` called by ${args.calledBy}`);
        }
        const provider =
          args.provider !== undefined
            ? getProviderOrThrow(args.provider)
            : null;
        const result = await signInImpl(enrichCtx(ctx), provider, args, {
          generateTokens: true,
          allowExtraProviders: false,
        });
        return Fx.run(
          Fx.match(result, result.kind, {
            redirect: (r) =>
              Fx.succeed({
                kind: "redirect" as const,
                redirect: r.redirect,
                verifier: r.verifier,
              }),
            signedIn: (r) =>
              Fx.succeed({
                kind: "signedIn" as const,
                tokens: r.signedIn?.tokens ?? null,
              }),
            refreshTokens: (r) =>
              Fx.succeed({
                kind: "signedIn" as const,
                tokens: r.signedIn?.tokens ?? null,
              }),
            started: () => Fx.succeed({ kind: "started" as const }),
            passkeyOptions: (r) =>
              Fx.succeed({
                kind: "passkeyOptions" as const,
                options: r.options,
                verifier: r.verifier,
              }),
            totpRequired: (r) =>
              Fx.succeed({
                kind: "totpRequired" as const,
                verifier: r.verifier,
              }),
            totpSetup: (r) =>
              Fx.succeed({
                kind: "totpSetup" as const,
                totpSetup: {
                  uri: r.uri,
                  secret: r.secret,
                  totpId: r.totpId,
                },
                verifier: r.verifier,
              }),
            deviceCode: (r) =>
              Fx.succeed({
                kind: "deviceCode" as const,
                deviceCode: {
                  deviceCode: r.deviceCode,
                  userCode: r.userCode,
                  verificationUri: r.verificationUri,
                  verificationUriComplete: r.verificationUriComplete,
                  expiresIn: r.expiresIn,
                  interval: r.interval,
                },
              }),
          }),
        );
      },
    }),
    /**
     * Action called by the client to invalidate the current session.
     */
    signOut: actionGeneric({
      args: {},
      handler: async (ctx) => {
        await callSignOut(ctx);
      },
    }),

    /**
     * Internal mutation used by the library to read and write
     * to the database during signin and signout.
     */
    store: internalMutationGeneric({
      args: storeArgs,
      handler: async (ctx: MutationCtx, args) => {
        return storeImpl(ctx, args, getProviderOrThrow, config);
      },
    }),
  };
}
