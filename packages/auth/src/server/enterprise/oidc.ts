import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding } from "@oslojs/encoding";
import { Fx } from "@robelest/fx";
import { decodeIdToken } from "arctic";
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";

import type { OAuthMaterializedConfig, OAuthProfile } from "../types";
import { enterpriseOidcProviderId, getEnterpriseOidcUrls } from "./shared";

const OIDC_JWKS_CACHE = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

async function discoverOidcConfiguration(config: Record<string, any>) {
  const discoveryUrl =
    typeof config.discoveryUrl === "string"
      ? config.discoveryUrl
      : typeof config.issuer === "string"
        ? `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`
        : null;

  if (!discoveryUrl) {
    throw new Error("Enterprise OIDC requires an issuer or discoveryUrl.");
  }

  const oidcFetch = createEnterpriseOidcFetch(config, config.issuer);

  return await Fx.run(
    Fx.defer(() =>
      Fx.from({
        ok: async () => {
          const response = await oidcFetch(discoveryUrl);
          if (!response.ok) {
            throw new Error(
              `Failed to discover OIDC configuration: ${response.status}`,
            );
          }
          const discovery = (await response.json()) as Record<string, any>;
          if (
            typeof discovery.issuer !== "string" ||
            typeof discovery.authorization_endpoint !== "string" ||
            typeof discovery.token_endpoint !== "string" ||
            typeof discovery.jwks_uri !== "string"
          ) {
            throw new Error(
              "OIDC discovery document is missing required fields.",
            );
          }
          return discovery;
        },
        err: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    ).pipe(
      Fx.timeout(10_000),
      Fx.retry(
        Fx.retry.compose(
          Fx.retry.jittered(Fx.retry.exponential(200)),
          Fx.retry.recurs(2),
        ),
      ),
      Fx.recover((error) =>
        Fx.fail(error instanceof Error ? error : new Error(String(error))),
      ),
    ),
  );
}

function createEnterpriseOidcFetch(
  config: Record<string, any>,
  discoveredIssuer?: string,
) {
  const runtimeOrigin =
    typeof config.discoveryUrl === "string"
      ? new URL(config.discoveryUrl).origin
      : undefined;
  const externalHost =
    typeof config.issuer === "string"
      ? new URL(config.issuer).host
      : typeof discoveredIssuer === "string"
        ? new URL(discoveredIssuer).host
        : undefined;

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

function getOidcJwks(
  url: string,
  fetchImpl?: ReturnType<typeof createEnterpriseOidcFetch>,
) {
  const cacheKey = fetchImpl ? `${url}::custom` : url;
  let jwks = OIDC_JWKS_CACHE.get(cacheKey);
  if (!jwks) {
    jwks = fetchImpl
      ? createRemoteJWKSet(new URL(url), { [customFetch]: fetchImpl })
      : createRemoteJWKSet(new URL(url));
    OIDC_JWKS_CACHE.set(cacheKey, jwks);
  }
  return jwks;
}

type UserInfoFetchFailure =
  | { kind: "transport"; error: unknown }
  | { kind: "subject-mismatch" };

function userInfoProfileFx(opts: {
  endpoint: string;
  accessToken: string;
  verifiedClaims: Record<string, unknown>;
  verifiedProfile: OAuthProfile & { emailVerified?: boolean };
  fetchImpl?: ReturnType<typeof createEnterpriseOidcFetch>;
}) {
  return Fx.from({
    ok: async () => {
      const response = await (opts.fetchImpl ?? fetch)(opts.endpoint, {
        headers: { Authorization: `Bearer ${opts.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`OIDC userinfo request failed: ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    err: (error): UserInfoFetchFailure => ({ kind: "transport", error }),
  }).pipe(
    Fx.chain((userInfo) => {
      const userInfoSubject =
        typeof userInfo.sub === "string" ? userInfo.sub : undefined;
      const tokenSubject =
        typeof opts.verifiedClaims.sub === "string"
          ? opts.verifiedClaims.sub
          : undefined;
      return userInfoSubject !== undefined &&
        tokenSubject !== undefined &&
        userInfoSubject !== tokenSubject
        ? Fx.fail({ kind: "subject-mismatch" } as const)
        : Fx.succeed({
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
    Fx.recover((failure) => {
      if (failure.kind === "transport") {
        return Fx.succeed(null);
      }
      return Fx.fail(
        new Error("OIDC userinfo subject does not match ID token subject."),
      );
    }),
  );
}

/** @internal */
export async function createEnterpriseOidcProvider(
  config: Record<string, any>,
  redirectUri: string,
) {
  const discovery = await discoverOidcConfiguration(config);
  const expectedIssuer = String(config.issuer ?? discovery.issuer).replace(
    /\/$/,
    "",
  );
  const discoveredIssuer = String(discovery.issuer).replace(/\/$/, "");
  const strictIssuer = config.strictIssuer === true;
  if (
    typeof config.issuer === "string" &&
    expectedIssuer !== discoveredIssuer
  ) {
    if (strictIssuer) {
      throw new Error(
        `Configured OIDC issuer mismatch. configured=${expectedIssuer} discovery=${discoveredIssuer}`,
      );
    }
    console.warn(
      "Configured OIDC issuer differs from discovery issuer; accepting both for token verification.",
      {
        configuredIssuer: expectedIssuer,
        discoveryIssuer: discoveredIssuer,
      },
    );
  }
  const authorizationEndpoint = discovery.authorization_endpoint as string;
  const tokenEndpoint = discovery.token_endpoint as string;
  const jwksUri = String(config.jwksUri ?? discovery.jwks_uri);
  const supportedIdTokenSigningAlgs = Array.isArray(
    discovery.id_token_signing_alg_values_supported,
  )
    ? discovery.id_token_signing_alg_values_supported.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : [];
  const userinfoEndpoint =
    (discovery.userinfo_endpoint as string | undefined) ?? undefined;
  const oidcFetch = createEnterpriseOidcFetch(
    config,
    discovery.issuer as string,
  );
  const scopes = Array.isArray(config.scopes)
    ? config.scopes.filter(
        (value: unknown): value is string => typeof value === "string",
      )
    : ["openid", "profile", "email"];
  const expectedAudience = config.audience ?? String(config.clientId);
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
  const jwks = getOidcJwks(jwksUri, oidcFetch);
  let verifiedClaims: Record<string, unknown> | null = null;
  let verifiedProfile: (OAuthProfile & { emailVerified?: boolean }) | null =
    null;
  const normalizeProfile = (claims: Record<string, unknown>) => ({
    id: typeof claims.sub === "string" ? claims.sub : crypto.randomUUID(),
    email: typeof claims.email === "string" ? claims.email : undefined,
    emailVerified:
      typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : undefined,
    name: typeof claims.name === "string" ? claims.name : undefined,
    image: typeof claims.picture === "string" ? claims.picture : undefined,
  });

  const provider = {
    createAuthorizationURL(
      state: string,
      codeVerifier: string,
      requestedScopes: string[],
    ) {
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", String(config.clientId));
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
      const authorizationParams =
        typeof config.authorizationParams === "object" &&
        config.authorizationParams !== null
          ? (config.authorizationParams as Record<string, unknown>)
          : {};
      for (const [key, value] of Object.entries(authorizationParams)) {
        if (typeof value === "string") {
          url.searchParams.set(key, value);
        }
      }
      return url;
    },
    async validateAuthorizationCode(code: string, codeVerifier?: string) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: String(config.clientId),
      });
      if (typeof config.clientSecret === "string") {
        body.set("client_secret", config.clientSecret);
      }
      if (codeVerifier) {
        body.set("code_verifier", codeVerifier);
      }
      const response = await oidcFetch(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) {
        throw new Error(`OIDC token exchange failed: ${response.status}`);
      }
      const data = (await response.json()) as Record<string, any>;
      return {
        data,
        idToken() {
          if (typeof data.id_token !== "string") {
            throw new Error("OIDC response is missing id_token.");
          }
          return data.id_token;
        },
        accessToken() {
          if (typeof data.access_token !== "string") {
            throw new Error("OIDC response is missing access_token.");
          }
          return data.access_token;
        },
      };
    },
  };

  const oauthConfig = {
    scopes,
    nonce: true,
    validateTokens: async (tokens: any, ctx: { nonce?: string }) => {
      const verified = await Fx.run(
        Fx.gen(function* () {
          yield* Fx.guard(
            ctx.nonce === undefined,
            Fx.fail(new Error("OIDC nonce is required.")),
          );

          const idToken = tokens.idToken();
          const protectedHeader = decodeProtectedHeader(idToken);
          const tokenAlg = protectedHeader.alg;
          const useSymmetricValidation =
            typeof tokenAlg === "string" &&
            (tokenAlg === "HS256" ||
              tokenAlg === "HS384" ||
              tokenAlg === "HS512") &&
            supportedIdTokenSigningAlgs.includes(tokenAlg);

          const verificationOptions = {
            audience: expectedAudience,
            requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
            clockTolerance: config.clockToleranceSeconds ?? 10,
          } as const;

          const verification = yield* Fx.from({
            ok: () =>
              useSymmetricValidation
                ? jwtVerify(
                    idToken,
                    (() => {
                      if (typeof config.clientSecret !== "string") {
                        throw new Error(
                          "OIDC provider uses symmetric ID token signatures but clientSecret is missing.",
                        );
                      }
                      return new TextEncoder().encode(config.clientSecret);
                    })(),
                    verificationOptions as any,
                  )
                : jwtVerify(idToken, jwks as any, verificationOptions as any),
            err: (error) =>
              error instanceof Error ? error : new Error(String(error)),
          });

          const payload = verification.payload as Record<string, unknown>;
          const tokenIssuerRaw =
            typeof payload.iss === "string" ? payload.iss : undefined;
          const tokenIssuer =
            typeof tokenIssuerRaw === "string"
              ? tokenIssuerRaw.replace(/\/$/, "")
              : undefined;

          yield* Fx.guard(
            !tokenIssuer || !expectedIssuers.includes(tokenIssuer),
            Fx.fail(
              new Error(
                `OIDC token issuer mismatch. Received: ${tokenIssuer ?? "<missing>"}. Expected one of: ${expectedIssuers.join(", ")}`,
              ),
            ),
          );

          yield* Fx.guard(
            payload.nonce !== ctx.nonce,
            Fx.fail(new Error("OIDC nonce mismatch.")),
          );

          yield* Fx.guard(
            Array.isArray(payload.aud) &&
              payload.aud.length > 1 &&
              payload.azp !== String(config.clientId),
            Fx.fail(
              new Error("OIDC authorized party does not match client ID."),
            ),
          );

          return payload;
        }),
      );

      verifiedClaims = verified;
      verifiedProfile = normalizeProfile(verified);
    },
    accountLinking: config.accountLinking,
    profile: async (tokens: any): Promise<OAuthProfile> => {
      if (verifiedProfile === null || verifiedClaims === null) {
        const claims = decodeIdToken(tokens.idToken()) as Record<
          string,
          unknown
        >;
        verifiedClaims = claims;
        verifiedProfile = normalizeProfile(claims);
      }
      if (userinfoEndpoint && typeof tokens.accessToken === "function") {
        const userInfoProfile = await Fx.run(
          userInfoProfileFx({
            endpoint: userinfoEndpoint,
            accessToken: tokens.accessToken(),
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
export async function createEnterpriseOidcRuntime(opts: {
  rootUrl: string;
  enterpriseId: string;
  oidc: Record<string, any>;
}) {
  const providerId = enterpriseOidcProviderId(opts.enterpriseId);
  const urls = getEnterpriseOidcUrls({
    rootUrl: opts.rootUrl,
    enterpriseId: opts.enterpriseId,
  });
  const { provider, oauthConfig } = await createEnterpriseOidcProvider(
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
