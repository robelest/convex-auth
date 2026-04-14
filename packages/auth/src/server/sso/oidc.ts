import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { decodeIdToken } from "arctic";
import { Cache, Duration, Effect, Match, Schedule, Schema } from "effect";
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import type { JWTVerifyGetKey, JWTVerifyOptions } from "jose";

import { log } from "../log";
import type {
  OIDCClaimMapping,
  OAuthMaterializedConfig,
  OAuthProfile,
  OAuthTokens,
} from "../types";
import { finalizeNormalizedProfile, normalizeStringArray } from "./profile";
import { groupOidcProviderId, getGroupOidcUrls } from "./shared";

const OIDC_JWKS_CACHE = Effect.runSync(
  Cache.make<string, ReturnType<typeof createRemoteJWKSet>>({
    capacity: 128,
    timeToLive: Duration.hours(1),
    lookup: (cacheKey) =>
      Effect.sync(() => {
        const key = JSON.parse(cacheKey) as {
          url: string;
          runtimeOrigin?: string;
          externalHost?: string;
        };
        const fetchImpl =
          key.runtimeOrigin !== undefined || key.externalHost !== undefined
            ? createGroupConnectionOidcFetchFromParts(
                key.runtimeOrigin,
                key.externalHost,
              )
            : undefined;
        return fetchImpl
          ? createRemoteJWKSet(new URL(key.url), { [customFetch]: fetchImpl })
          : createRemoteJWKSet(new URL(key.url));
      }),
  }),
);

const NETWORK_RETRY_SCHEDULE = Schedule.both(
  Schedule.jittered(Schedule.exponential("200 millis")),
  Schedule.recurs(2),
);

const OidcDiscoverySchema = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
  userinfo_endpoint: Schema.optional(Schema.String),
  token_endpoint_auth_methods_supported: Schema.optional(
    Schema.Array(Schema.String),
  ),
  id_token_signing_alg_values_supported: Schema.optional(
    Schema.Array(Schema.String),
  ),
});

const OidcUserInfoSchema = Schema.Struct({
  sub: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  email_verified: Schema.optional(Schema.Boolean),
  name: Schema.optional(Schema.String),
  picture: Schema.optional(Schema.String),
});

type OidcDiscovery = Schema.Schema.Type<typeof OidcDiscoverySchema>;
type OidcUserInfo = Schema.Schema.Type<typeof OidcUserInfoSchema>;

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

function getOidcSections(config: Record<string, unknown>) {
  return {
    discovery:
      typeof config.discovery === "object" && config.discovery !== null
        ? (config.discovery as Record<string, unknown>)
        : {},
    client:
      typeof config.client === "object" && config.client !== null
        ? (config.client as Record<string, unknown>)
        : {},
    request:
      typeof config.request === "object" && config.request !== null
        ? (config.request as Record<string, unknown>)
        : {},
    security:
      typeof config.security === "object" && config.security !== null
        ? (config.security as Record<string, unknown>)
        : {},
    profile:
      typeof config.profile === "object" && config.profile !== null
        ? (config.profile as Record<string, unknown>)
        : {},
  };
}

function discoverOidcConfiguration(config: Record<string, unknown>) {
  const { discovery } = getOidcSections(config);
  const discoveryUrl =
    typeof discovery.discoveryUrl === "string"
      ? discovery.discoveryUrl
      : typeof discovery.issuer === "string"
        ? `${discovery.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
        : null;

  if (!discoveryUrl) {
    throw new Error(
      "Group connection OIDC requires an issuer or discoveryUrl.",
    );
  }

  const oidcFetch = createGroupConnectionOidcFetch(
    config,
    typeof discovery.issuer === "string" ? discovery.issuer : undefined,
  );

  return Effect.tryPromise({
    try: async () => {
      const response = await oidcFetch(discoveryUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(
          `Failed to discover OIDC configuration: ${response.status}`,
        );
      }
      return Schema.decodeUnknownSync(OidcDiscoverySchema)(
        await response.json(),
      );
    },
    catch: asError,
  }).pipe(
    Effect.retry({ schedule: NETWORK_RETRY_SCHEDULE }),
    Effect.withSpan("convex-auth.sso.oidc.discovery"),
  );
}

function createGroupConnectionOidcFetch(
  config: Record<string, unknown>,
  discoveredIssuer?: string,
) {
  const { discovery } = getOidcSections(config);
  const runtimeOrigin =
    typeof discovery.discoveryUrl === "string"
      ? new URL(discovery.discoveryUrl).origin
      : undefined;
  const externalHost =
    typeof discovery.issuer === "string"
      ? new URL(discovery.issuer).host
      : typeof discoveredIssuer === "string"
        ? new URL(discoveredIssuer).host
        : undefined;

  return createGroupConnectionOidcFetchFromParts(runtimeOrigin, externalHost);
}

function createGroupConnectionOidcFetchFromParts(
  runtimeOrigin?: string,
  externalHost?: string,
) {
  return async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const rewrittenUrl =
      runtimeOrigin !== undefined && url.origin !== runtimeOrigin
        ? new URL(`${runtimeOrigin}${url.pathname}${url.search}`)
        : url;
    const headers = new Headers(init?.headers);
    if (runtimeOrigin !== undefined && externalHost !== undefined) {
      headers.set("host", externalHost);
    }
    return await fetch(rewrittenUrl, { ...init, headers });
  };
}

function normalizeOidcProfile(
  claims: Record<string, unknown>,
  mapping?: OIDCClaimMapping,
) {
  const getMapped = (key: string | undefined) =>
    typeof key === "string" ? claims[key] : undefined;
  return finalizeNormalizedProfile({
    id:
      (typeof getMapped(mapping?.subject) === "string"
        ? (getMapped(mapping?.subject) as string)
        : undefined) ??
      (typeof claims.sub === "string" ? claims.sub : crypto.randomUUID()),
    email:
      (typeof getMapped(mapping?.email) === "string"
        ? (getMapped(mapping?.email) as string)
        : undefined) ??
      (typeof claims.email === "string" ? claims.email : undefined),
    emailVerified:
      (typeof getMapped(mapping?.emailVerified) === "boolean"
        ? (getMapped(mapping?.emailVerified) as boolean)
        : undefined) ??
      (typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : undefined),
    name:
      (typeof getMapped(mapping?.name) === "string"
        ? (getMapped(mapping?.name) as string)
        : undefined) ??
      (typeof claims.name === "string" ? claims.name : undefined),
    image:
      (typeof getMapped(mapping?.image) === "string"
        ? (getMapped(mapping?.image) as string)
        : undefined) ??
      (typeof claims.picture === "string" ? claims.picture : undefined),
    groups: normalizeStringArray(getMapped(mapping?.groups)),
    roles: normalizeStringArray(getMapped(mapping?.roles)),
  });
}

function getOidcJwks(
  url: string,
  runtimeOrigin?: string,
  externalHost?: string,
  fetchImpl?: ReturnType<typeof createGroupConnectionOidcFetch>,
) {
  const cacheKey = JSON.stringify({
    url,
    runtimeOrigin: fetchImpl ? runtimeOrigin : undefined,
    externalHost: fetchImpl ? externalHost : undefined,
  });
  return Effect.runSync(Cache.get(OIDC_JWKS_CACHE, cacheKey));
}

type UserInfoFetchFailure =
  | { kind: "transport"; error: unknown }
  | { kind: "subject-mismatch" };

function userInfoProfileFx(opts: {
  endpoint: string;
  accessToken: string;
  verifiedClaims: Record<string, unknown>;
  verifiedProfile: OAuthProfile & { emailVerified?: boolean };
  fetchImpl?: ReturnType<typeof createGroupConnectionOidcFetch>;
}) {
  return Effect.tryPromise({
    try: async () => {
      const response = await (opts.fetchImpl ?? fetch)(opts.endpoint, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`OIDC userinfo request failed: ${response.status}`);
      }
      return Schema.decodeUnknownSync(OidcUserInfoSchema)(
        await response.json(),
      );
    },
    catch: (error): UserInfoFetchFailure => ({ kind: "transport", error }),
  }).pipe(
    Effect.flatMap((userInfo: OidcUserInfo) => {
      const userInfoSubject =
        typeof userInfo.sub === "string" ? userInfo.sub : undefined;
      const tokenSubject =
        typeof opts.verifiedClaims.sub === "string"
          ? opts.verifiedClaims.sub
          : undefined;
      return userInfoSubject !== undefined &&
        tokenSubject !== undefined &&
        userInfoSubject !== tokenSubject
        ? Effect.fail({ kind: "subject-mismatch" } as const)
        : Effect.succeed({
            id:
              userInfoSubject ??
              (typeof opts.verifiedClaims.sub === "string"
                ? opts.verifiedClaims.sub
                : undefined) ??
              crypto.randomUUID(),
            email:
              typeof userInfo.email === "string"
                ? userInfo.email
                : opts.verifiedProfile.email,
            emailVerified:
              typeof userInfo.email_verified === "boolean"
                ? userInfo.email_verified
                : opts.verifiedProfile.emailVerified,
            name:
              typeof userInfo.name === "string"
                ? userInfo.name
                : opts.verifiedProfile.name,
            image:
              typeof userInfo.picture === "string"
                ? userInfo.picture
                : opts.verifiedProfile.image,
          } as OAuthProfile & { emailVerified?: boolean });
    }),
    Effect.catch((failure) =>
      Match.value(failure).pipe(
        Match.when({ kind: "transport" }, () => Effect.succeed(null)),
        Match.orElse(() =>
          Effect.fail(
            new Error("OIDC userinfo subject does not match ID token subject."),
          ),
        ),
      ),
    ),
    Effect.withSpan("convex-auth.sso.oidc.userinfo"),
  );
}

/** @internal */
export async function createGroupConnectionOidcProvider(
  config: Record<string, unknown>,
  redirectUri: string,
) {
  const {
    discovery: discoveryConfig,
    client,
    request,
    security,
    profile,
  } = getOidcSections(config);
  const discovery: OidcDiscovery = await Effect.runPromise(
    discoverOidcConfiguration(config),
  );
  const discoveredIssuer =
    typeof discovery.issuer === "string"
      ? discovery.issuer.replace(/\/$/, "")
      : "";
  const expectedIssuer =
    typeof discoveryConfig.issuer === "string"
      ? discoveryConfig.issuer.replace(/\/$/, "")
      : discoveredIssuer;
  const strictIssuer = security.strictIssuer === true;
  if (
    typeof discoveryConfig.issuer === "string" &&
    expectedIssuer !== discoveredIssuer
  ) {
    if (strictIssuer) {
      throw new Error(
        `Configured OIDC issuer mismatch. configured=${expectedIssuer} discovery=${discoveredIssuer}`,
      );
    }
    log(
      "WARN",
      "Configured OIDC issuer differs from discovery issuer; accepting both for token verification.",
      {
        configuredIssuer: expectedIssuer,
        discoveryIssuer: discoveredIssuer,
      },
    );
  }
  const authorizationEndpoint = discovery.authorization_endpoint as string;
  const tokenEndpoint = discovery.token_endpoint as string;
  const jwksUri =
    typeof discoveryConfig.jwksUri === "string"
      ? discoveryConfig.jwksUri
      : typeof discovery.jwks_uri === "string"
        ? discovery.jwks_uri
        : "";
  const supportedIdTokenSigningAlgs = Array.isArray(
    discovery.id_token_signing_alg_values_supported,
  )
    ? discovery.id_token_signing_alg_values_supported.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : [];
  const discoveredTokenEndpointAuthMethods = Array.isArray(
    discovery.token_endpoint_auth_methods_supported,
  )
    ? discovery.token_endpoint_auth_methods_supported.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : [];
  const tokenEndpointAuthMethod =
    client.authMethod === "client_secret_basic" ||
    client.authMethod === "client_secret_post"
      ? client.authMethod
      : discoveredTokenEndpointAuthMethods.includes("client_secret_basic")
        ? "client_secret_basic"
        : "client_secret_post";
  const userinfoEndpoint =
    (discovery.userinfo_endpoint as string | undefined) ?? undefined;
  const claimMapping =
    typeof profile.mapping === "object" && profile.mapping !== null
      ? (profile.mapping as OIDCClaimMapping)
      : undefined;
  const oidcFetch = createGroupConnectionOidcFetch(
    config,
    discovery.issuer as string,
  );
  const runtimeOrigin =
    typeof discoveryConfig.discoveryUrl === "string"
      ? new URL(discoveryConfig.discoveryUrl).origin
      : undefined;
  const externalHost =
    typeof discoveryConfig.issuer === "string"
      ? new URL(discoveryConfig.issuer).host
      : typeof discovery.issuer === "string"
        ? new URL(discovery.issuer).host
        : undefined;
  const scopes = Array.isArray(request.scopes)
    ? request.scopes.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : ["openid", "profile", "email"];
  const expectedAudience: string | string[] = Array.isArray(
    discoveryConfig.audience,
  )
    ? discoveryConfig.audience.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : typeof discoveryConfig.audience === "string"
      ? discoveryConfig.audience
      : String(client.id);
  const clockToleranceSeconds =
    typeof security.clockToleranceSeconds === "number"
      ? security.clockToleranceSeconds
      : 10;
  const getIssuerCandidates = (issuer: string) => {
    const candidates = [issuer];
    if (issuer.startsWith("https://")) {
      candidates.push(`http://${issuer.slice("https://".length)}`);
    } else if (issuer.startsWith("http://")) {
      candidates.push(`https://${issuer.slice("http://".length)}`);
    }
    return candidates;
  };
  const expectedIssuers = strictIssuer
    ? [expectedIssuer]
    : Array.from(
        new Set([
          ...getIssuerCandidates(expectedIssuer),
          ...getIssuerCandidates(discoveredIssuer),
        ]),
      );
  const jwks = getOidcJwks(jwksUri, runtimeOrigin, externalHost, oidcFetch);
  let verifiedClaims: Record<string, unknown> | null = null;
  let verifiedProfile: (OAuthProfile & { emailVerified?: boolean }) | null =
    null;
  const normalizeProfile = (claims: Record<string, unknown>) =>
    normalizeOidcProfile(claims, claimMapping);

  const provider = {
    pkce: "required" as const,
    createAuthorizationURL({
      state,
      codeVerifier,
      scopes: requestedScopes,
      nonce,
      loginHint,
    }: {
      state: string;
      codeVerifier?: string;
      scopes: string[];
      nonce?: string;
      loginHint?: string;
    }) {
      if (!codeVerifier) {
        throw new Error("OIDC PKCE requires a code verifier.");
      }
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", String(client.id));
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set(
        "scope",
        (requestedScopes.length > 0 ? requestedScopes : scopes).join(" "),
      );
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set(
        "code_challenge",
        encodeBase64urlNoPadding(
          sha256(new TextEncoder().encode(codeVerifier)),
        ),
      );
      if (nonce !== undefined) {
        url.searchParams.set("nonce", nonce);
      }
      if (typeof loginHint === "string") {
        url.searchParams.set("login_hint", loginHint);
      }
      const authorizationParams =
        typeof request.authorizationParams === "object" &&
        request.authorizationParams !== null
          ? (request.authorizationParams as Record<string, unknown>)
          : {};
      for (const [key, value] of Object.entries(authorizationParams)) {
        if (typeof value === "string") {
          url.searchParams.set(key, value);
        }
      }
      return url;
    },
    async validateAuthorizationCode({
      code,
      codeVerifier,
    }: {
      code: string;
      codeVerifier?: string;
    }) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
      const headers = new Headers({
        "Content-Type": "application/x-www-form-urlencoded",
      });
      if (
        typeof client.secret === "string" &&
        tokenEndpointAuthMethod === "client_secret_basic"
      ) {
        const basicAuth =
          typeof btoa === "function"
            ? btoa(`${String(client.id)}:${client.secret}`)
            : Buffer.from(`${String(client.id)}:${client.secret}`).toString(
                "base64",
              );
        headers.set("Authorization", `Basic ${basicAuth}`);
      } else {
        body.set("client_id", String(client.id));
        if (typeof client.secret === "string") {
          body.set("client_secret", client.secret);
        }
      }
      if (codeVerifier) {
        body.set("code_verifier", codeVerifier);
      }
      const response = await oidcFetch(tokenEndpoint, {
        method: "POST",
        headers,
        body,
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `OIDC token exchange failed: ${response.status}${detail ? ` ${detail}` : ""}`,
        );
      }
      const data = (await response.json()) as Record<string, unknown>;
      return {
        accessToken:
          typeof data.access_token === "string" ? data.access_token : undefined,
        refreshToken:
          typeof data.refresh_token === "string"
            ? data.refresh_token
            : undefined,
        idToken: typeof data.id_token === "string" ? data.id_token : undefined,
        accessTokenExpiresAt:
          typeof data.expires_in === "number"
            ? new Date(Date.now() + data.expires_in * 1000)
            : undefined,
        scopes:
          typeof data.scope === "string"
            ? data.scope
                .split(/[\s,]+/)
                .map((scope) => scope.trim())
                .filter((scope) => scope.length > 0)
            : undefined,
        raw: data,
      };
    },
  };

  const oauthConfig = {
    scopes,
    nonce: true,
    validateTokens: async (tokens: OAuthTokens, ctx: { nonce?: string }) => {
      const verified = await Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.nonce === undefined) {
            return yield* Effect.fail(new Error("OIDC nonce is required."));
          }

          const idToken = tokens.idToken;
          if (idToken === undefined) {
            return yield* Effect.fail(
              new Error("OIDC response is missing id_token."),
            );
          }
          const verifiedIdToken = idToken;
          const protectedHeader = decodeProtectedHeader(verifiedIdToken);
          const tokenAlg = protectedHeader.alg;
          const useSymmetricValidation =
            typeof tokenAlg === "string" &&
            (tokenAlg === "HS256" ||
              tokenAlg === "HS384" ||
              tokenAlg === "HS512") &&
            supportedIdTokenSigningAlgs.includes(tokenAlg);

          const verificationOptions: JWTVerifyOptions = {
            audience: expectedAudience,
            requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
            clockTolerance: clockToleranceSeconds,
          };

          const verification = yield* Effect.tryPromise({
            try: () =>
              useSymmetricValidation
                ? jwtVerify(
                    verifiedIdToken,
                    (() => {
                      if (typeof client.secret !== "string") {
                        throw new Error(
                          "OIDC provider uses symmetric ID token signatures but clientSecret is missing.",
                        );
                      }
                      return new TextEncoder().encode(client.secret);
                    })(),
                    verificationOptions,
                  )
                : jwtVerify(
                    verifiedIdToken,
                    jwks as JWTVerifyGetKey,
                    verificationOptions,
                  ),
            catch: asError,
          });

          const payload = verification.payload as Record<string, unknown>;
          const tokenIssuerRaw =
            typeof payload.iss === "string" ? payload.iss : undefined;
          const tokenIssuer =
            typeof tokenIssuerRaw === "string"
              ? tokenIssuerRaw.replace(/\/$/, "")
              : undefined;

          if (!tokenIssuer || !expectedIssuers.includes(tokenIssuer)) {
            return yield* Effect.fail(
              new Error(
                `OIDC token issuer mismatch. Received: ${tokenIssuer ?? "<missing>"}. Expected one of: ${expectedIssuers.join(", ")}`,
              ),
            );
          }

          if (payload.nonce !== ctx.nonce) {
            return yield* Effect.fail(new Error("OIDC nonce mismatch."));
          }

          if (
            Array.isArray(payload.aud) &&
            payload.aud.length > 1 &&
            payload.azp !== String(client.id)
          ) {
            return yield* Effect.fail(
              new Error("OIDC authorized party does not match client ID."),
            );
          }

          return payload;
        }),
      );

      verifiedClaims = verified;
      verifiedProfile = normalizeProfile(verified);
    },
    accountLinking: config.accountLinking,
    profile: async (tokens: OAuthTokens): Promise<OAuthProfile> => {
      if (verifiedProfile === null || verifiedClaims === null) {
        if (tokens.idToken === undefined) {
          throw new Error("OIDC response is missing id_token.");
        }
        const claims = decodeIdToken(tokens.idToken) as Record<string, unknown>;
        verifiedClaims = claims;
        verifiedProfile = normalizeProfile(claims);
      }
      if (userinfoEndpoint && typeof tokens.accessToken === "string") {
        const userInfoProfile = await Effect.runPromise(
          userInfoProfileFx({
            endpoint: userinfoEndpoint,
            accessToken: tokens.accessToken,
            verifiedClaims,
            verifiedProfile,
            fetchImpl: oidcFetch,
          }),
        );
        if (userInfoProfile !== null) {
          return userInfoProfile;
        }
      }
      return verifiedProfile;
    },
  } as const;

  return { provider, oauthConfig };
}

/** @internal */
export function createSyntheticOAuthMaterializedConfig(
  providerId: string,
  options?: {
    accountLinking?: OAuthMaterializedConfig["accountLinking"];
  },
): OAuthMaterializedConfig {
  return {
    id: providerId,
    type: "oauth",
    provider: null,
    scopes: [],
    accountLinking: options?.accountLinking ?? "verifiedEmail",
  };
}

/** @internal */
export async function createGroupConnectionOidcRuntime(opts: {
  rootUrl: string;
  connectionId: string;
  oidc: Record<string, unknown>;
  sharedRedirectURI?: string;
}) {
  const providerId = groupOidcProviderId(opts.connectionId);
  const urls = getGroupOidcUrls({
    rootUrl: opts.rootUrl,
    connectionId: opts.connectionId,
    sharedRedirectURI: opts.sharedRedirectURI,
  });
  const { provider, oauthConfig } = await createGroupConnectionOidcProvider(
    opts.oidc,
    urls.callbackUrl,
  );
  return {
    oidc: opts.oidc,
    providerId,
    provider,
    oauthConfig,
    ...urls,
  };
}

/** @internal */
