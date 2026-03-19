import { sha256 } from "@oslojs/crypto/sha2";
import {
  decodeBase64urlIgnorePadding,
  encodeBase64urlNoPadding,
} from "@oslojs/encoding";
import { Fx } from "@robelest/fx";
import {
  Constants,
  IdentityProvider,
  ServiceProvider,
  setSchemaValidator,
} from "@robelest/samlify";

// Samlify requires a schema validator to be registered before parsing any SAML
// response. We use a permissive validator that always resolves because Convex's
// edge runtime has no file-system access for XML schema files, and structural
// correctness is already ensured by the XML parser. This is called directly
// before each parse operation since Convex can restart the V8 isolate between
// requests, resetting module-level state.
const _samlifyPermissiveValidator = {
  validate: (_xml: string) => Promise.resolve("OK"),
};
function ensureSamlifyValidator() {
  setSchemaValidator(_samlifyPermissiveValidator);
}
import { decodeIdToken } from "arctic";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

import type {
  OAuthMaterializedConfig,
  OAuthProfile,
  SAMLAttributeMapping,
} from "./types";

export type ParsedSamlMetadata = {
  issuer: string;
  sso: {
    redirect?: string;
    post?: string;
  };
  slo: {
    redirect?: string;
    post?: string;
  };
  signingCert: string | string[] | null;
  encryptionCert: string | string[] | null;
  nameIdFormats: string[];
  wantsSignedAuthnRequests: boolean;
};

export type EnterpriseSamlSource = { kind: "enterprise"; id: string };

export type EnterpriseSamlRelayState = {
  source: EnterpriseSamlSource;
  signature: string;
  requestId: string;
  state: string;
  redirectTo?: string;
};

export type EnterpriseSamlUrls = {
  metadataUrl: string;
  acsUrl: string;
  sloUrl?: string;
};

export type EnterpriseSamlLoadedSource = {
  source: EnterpriseSamlSource;
  config: unknown;
  status?: string;
};

export type EnterpriseSamlHttpRequest = {
  url: URL;
  body: Record<string, string>;
  query: Record<string, string>;
  binding: "redirect" | "post";
  relayState?: string;
  hasSamlRequest: boolean;
  hasSamlResponse: boolean;
};

export type ScimListRequest = {
  startIndex: number;
  count: number;
  filter?: { attribute: string; value: string };
};

export const SCIM_USER_SCHEMA_ID = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA_ID =
  "urn:ietf:params:scim:schemas:core:2.0:Group";

export const ENTERPRISE_OIDC_PROVIDER_PREFIX = "enterprise:oidc:";
export const ENTERPRISE_SAML_PROVIDER_PREFIX = "enterprise:saml:";
const OIDC_JWKS_CACHE = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

export function enterpriseOidcProviderId(enterpriseId: string): string {
  return `${ENTERPRISE_OIDC_PROVIDER_PREFIX}${enterpriseId}`;
}

export function enterpriseSamlProviderId(enterpriseId: string): string {
  return `${ENTERPRISE_SAML_PROVIDER_PREFIX}${enterpriseId}`;
}

export function getEnterpriseSamlUrls(opts: {
  rootUrl: string;
  source: EnterpriseSamlSource;
}): EnterpriseSamlUrls {
  const root = opts.rootUrl.replace(/\/$/, "");
  const metadataBase = `${root}/api/auth/sso/${opts.source.id}/saml/metadata`;
  const acsBase = `${root}/api/auth/sso/${opts.source.id}/saml/acs`;
  const sloBase = `${root}/api/auth/sso/${opts.source.id}/saml/slo`;
  return {
    metadataUrl: metadataBase,
    acsUrl: acsBase,
    sloUrl: sloBase,
  };
}

export function getEnterpriseOidcUrls(opts: {
  rootUrl: string;
  enterpriseId: string;
}) {
  const root = opts.rootUrl.replace(/\/$/, "");
  return {
    signInUrl: `${root}/api/auth/sso/${opts.enterpriseId}/oidc/signin`,
    callbackUrl: `${root}/api/auth/sso/${opts.enterpriseId}/oidc/callback`,
  };
}

export function isEnterpriseSamlSourceActive(
  source: EnterpriseSamlLoadedSource,
) {
  return source.status === "active";
}

export function isEnterpriseProviderId(providerId: string): boolean {
  return (
    providerId.startsWith(ENTERPRISE_OIDC_PROVIDER_PREFIX) ||
    providerId.startsWith(ENTERPRISE_SAML_PROVIDER_PREFIX)
  );
}

const asRecord = (value: unknown) =>
  typeof value === "object" && value !== null
    ? (value as Record<string, any>)
    : null;

const getProtocolConfig = (config: unknown, protocol: "oidc" | "saml") => {
  const base = asRecord(config);
  const direct = base?.[protocol];
  const viaProtocols = asRecord(base?.protocols)?.[protocol];
  return asRecord(direct) ?? asRecord(viaProtocols) ?? {};
};

export function getOidcConfig(config: unknown): Record<string, any> {
  return getProtocolConfig(config, "oidc");
}

export function getSamlConfig(config: unknown): Record<string, any> {
  return getProtocolConfig(config, "saml");
}

export function upsertProtocolConfig(
  config: unknown,
  protocol: "oidc" | "saml",
  protocolConfig: Record<string, unknown>,
) {
  const base = asRecord(config) ?? {};
  const protocols = asRecord(base.protocols) ?? {};
  protocols[protocol] = {
    ...asRecord(protocols[protocol]),
    ...protocolConfig,
  };
  return { ...base, protocols };
}

export function createSamlPostBindingResponse(opts: {
  endpoint: string;
  parameter: "SAMLRequest" | "SAMLResponse";
  value: string;
  relayState?: string;
}) {
  const fields = [
    `<input type="hidden" name="${opts.parameter}" value="${opts.value.replace(/"/g, "&quot;")}" />`,
    opts.relayState
      ? `<input type="hidden" name="RelayState" value="${opts.relayState.replace(/"/g, "&quot;")}" />`
      : "",
  ].join("");
  return new Response(
    `<!doctype html><html><body><form method="POST" action="${opts.endpoint}">${fields}</form><script>document.forms[0].submit();</script></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export function decodeRelayState(
  value: string | null,
): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(
      new TextDecoder().decode(decodeBase64urlIgnorePadding(value)),
    );
  } catch {
    return {};
  }
}

export function encodeEnterpriseSamlRelayState(
  value: EnterpriseSamlRelayState,
) {
  return encodeBase64urlNoPadding(
    new TextEncoder().encode(
      JSON.stringify({
        source: `${value.source.kind}:${value.source.id}`,
        signature: value.signature,
        requestId: value.requestId,
        state: value.state,
        redirectTo: value.redirectTo,
      }),
    ),
  );
}

export function decodeEnterpriseSamlRelayStateOrThrow(
  value: string | null,
): EnterpriseSamlRelayState {
  if (!value) {
    throw new Error("Missing SAML RelayState.");
  }
  const decoded = decodeRelayState(value);
  if (
    typeof decoded.source !== "string" ||
    typeof decoded.signature !== "string" ||
    typeof decoded.requestId !== "string" ||
    typeof decoded.state !== "string"
  ) {
    throw new Error("Invalid SAML RelayState.");
  }
  const [kind, ...rest] = decoded.source.split(":");
  const id = rest.join(":");
  if (kind !== "enterprise" || id.length === 0) {
    throw new Error("Invalid enterprise SAML source.");
  }
  return {
    source: { kind, id } as EnterpriseSamlSource,
    signature: decoded.signature,
    requestId: decoded.requestId,
    state: decoded.state,
    redirectTo:
      typeof decoded.redirectTo === "string" ? decoded.redirectTo : undefined,
  };
}

export async function readRequestBody(
  request: Request,
): Promise<Record<string, string>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const body: Record<string, string> = {};
    form.forEach((value, key) => {
      body[key] = typeof value === "string" ? value : value.name;
    });
    return body;
  }
  return {};
}

export async function readEnterpriseSamlHttpRequest(
  request: Request,
): Promise<EnterpriseSamlHttpRequest> {
  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const query = Object.fromEntries(url.searchParams);
  const binding =
    request.method === "GET"
      ? "redirect"
      : body.SAMLResponse || body.SAMLRequest
        ? "post"
        : "redirect";
  return {
    url,
    body,
    query,
    binding,
    relayState:
      body.RelayState ?? url.searchParams.get("RelayState") ?? undefined,
    hasSamlRequest: Boolean(
      body.SAMLRequest ?? url.searchParams.get("SAMLRequest"),
    ),
    hasSamlResponse: Boolean(
      body.SAMLResponse ?? url.searchParams.get("SAMLResponse"),
    ),
  };
}

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

  return await Fx.run(
    Fx.defer(() =>
      Fx.from({
        ok: async () => {
          const response = await fetch(discoveryUrl);
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

function getOidcJwks(url: string) {
  let jwks = OIDC_JWKS_CACHE.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    OIDC_JWKS_CACHE.set(url, jwks);
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
}) {
  return Fx.from({
    ok: async () => {
      const response = await fetch(opts.endpoint, {
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
  const jwks = getOidcJwks(jwksUri);
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
      const response = await fetch(tokenEndpoint, {
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

export function createSyntheticOAuthMaterializedConfig(
  providerId: string,
): OAuthMaterializedConfig {
  return {
    id: providerId,
    type: "oauth",
    provider: null,
    scopes: [],
    accountLinking: "verifiedEmail",
  };
}

export function parseSamlIdpMetadata(metadata: string): ParsedSamlMetadata {
  const idp = IdentityProvider({ metadata });
  const entityMeta = idp.entityMeta;

  const normalizeService = (value: unknown): string | undefined => {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  return {
    issuer: entityMeta.getEntityID(),
    sso: {
      redirect: normalizeService(entityMeta.getSingleSignOnService("redirect")),
      post: normalizeService(entityMeta.getSingleSignOnService("post")),
    },
    slo: {
      redirect: normalizeService(entityMeta.getSingleLogoutService("redirect")),
      post: normalizeService(entityMeta.getSingleLogoutService("post")),
    },
    signingCert: entityMeta.getX509Certificate("signing"),
    encryptionCert: entityMeta.getX509Certificate("encrypt"),
    nameIdFormats: (() => {
      const nameIdFormat = entityMeta.getNameIDFormat();
      return Array.isArray(nameIdFormat) ? nameIdFormat : [];
    })(),
    wantsSignedAuthnRequests: entityMeta.isWantAuthnRequestsSigned(),
  };
}

export function createServiceProviderMetadata(opts: {
  entityId: string;
  acsUrl: string;
  sloUrl?: string;
  authnRequestsSigned?: boolean;
  signingCert?: string | string[];
  encryptCert?: string | string[];
  privateKey?: string;
  privateKeyPass?: string;
  encPrivateKey?: string;
  encPrivateKeyPass?: string;
}) {
  const binding = Constants.namespace.binding;
  const sp = ServiceProvider({
    entityID: opts.entityId,
    authnRequestsSigned: opts.authnRequestsSigned ?? false,
    privateKey: opts.privateKey,
    privateKeyPass: opts.privateKeyPass,
    signingCert: opts.signingCert,
    encryptCert: opts.encryptCert,
    encPrivateKey: opts.encPrivateKey,
    encPrivateKeyPass: opts.encPrivateKeyPass,
    assertionConsumerService: [
      {
        Binding: binding.post,
        Location: opts.acsUrl,
      },
    ],
    singleLogoutService: opts.sloUrl
      ? [
          {
            Binding: binding.redirect,
            Location: opts.sloUrl,
          },
          {
            Binding: binding.post,
            Location: opts.sloUrl,
          },
        ]
      : undefined,
  });
  return sp.getMetadata();
}

export function createEnterpriseSamlMetadataXml(opts: {
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
}) {
  return createServiceProviderMetadata(
    getSamlServiceProviderOptions({
      rootUrl: opts.rootUrl,
      source: opts.source,
      config: opts.config,
    }),
  );
}

export function getSamlServiceProviderOptions(opts: {
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
  overrides?: {
    entityId?: string;
    acsUrl?: string;
    sloUrl?: string;
  };
  relayState?: string;
}) {
  const saml = getSamlConfig(opts.config);
  const sp = asRecord(saml.sp) ?? {};
  const urls = getEnterpriseSamlUrls({
    rootUrl: opts.rootUrl,
    source: opts.source,
  });
  return {
    entityId: opts.overrides?.entityId ?? sp.entityId ?? urls.metadataUrl,
    acsUrl: opts.overrides?.acsUrl ?? sp.acsUrl ?? urls.acsUrl,
    sloUrl: opts.overrides?.sloUrl ?? sp.sloUrl ?? urls.sloUrl,
    relayState: opts.relayState,
    authnRequestsSigned: saml.signAuthnRequests,
    signingCert: sp.signingCert,
    encryptCert: sp.encryptCert,
    privateKey: sp.privateKey,
    privateKeyPass: sp.privateKeyPass,
    encPrivateKey: sp.encPrivateKey,
    encPrivateKeyPass: sp.encPrivateKeyPass,
  };
}

export function createSamlServiceProvider(opts: {
  entityId: string;
  acsUrl: string;
  sloUrl?: string;
  relayState?: string;
  authnRequestsSigned?: boolean;
  signingCert?: string | string[];
  encryptCert?: string | string[];
  privateKey?: string;
  privateKeyPass?: string;
  encPrivateKey?: string;
  encPrivateKeyPass?: string;
}) {
  const binding = Constants.namespace.binding;
  return ServiceProvider({
    entityID: opts.entityId,
    relayState: opts.relayState ?? "",
    authnRequestsSigned: opts.authnRequestsSigned ?? false,
    privateKey: opts.privateKey,
    privateKeyPass: opts.privateKeyPass,
    signingCert: opts.signingCert,
    encryptCert: opts.encryptCert,
    encPrivateKey: opts.encPrivateKey,
    encPrivateKeyPass: opts.encPrivateKeyPass,
    assertionConsumerService: [
      {
        Binding: binding.post,
        Location: opts.acsUrl,
      },
    ],
    singleLogoutService: opts.sloUrl
      ? [
          { Binding: binding.redirect, Location: opts.sloUrl },
          { Binding: binding.post, Location: opts.sloUrl },
        ]
      : undefined,
  });
}

export function createEnterpriseSamlRuntime(opts: {
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
  relayState?: string;
  overrides?: {
    entityId?: string;
    acsUrl?: string;
    sloUrl?: string;
  };
}) {
  const saml = getSamlConfig(opts.config);
  const spOptions = getSamlServiceProviderOptions({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
    relayState: opts.relayState,
    overrides: opts.overrides,
  });
  if (typeof saml.idp?.metadataXml !== "string") {
    throw new Error("SAML IdP metadata is missing.");
  }
  return {
    saml,
    sp: createSamlServiceProvider(spOptions),
    idp: IdentityProvider({ metadata: saml.idp.metadataXml }),
    urls: getEnterpriseSamlUrls({ rootUrl: opts.rootUrl, source: opts.source }),
  };
}

export function createEnterpriseSamlSignInRequest(opts: {
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
  state: string;
  signature: string;
  redirectTo?: string;
}) {
  const runtime = createEnterpriseSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
  });
  const binding = runtime.saml.idp.sso?.redirect ? "redirect" : "post";
  const loginRequest = runtime.sp.createLoginRequest(
    runtime.idp,
    binding as any,
  ) as any;
  const relayState = encodeEnterpriseSamlRelayState({
    source: opts.source,
    signature: opts.signature,
    requestId: loginRequest.id,
    state: opts.state,
    redirectTo: opts.redirectTo,
  });
  return {
    requestId: loginRequest.id as string,
    binding,
    relayState,
    redirectUrl:
      binding === "redirect"
        ? (() => {
            const redirectUrl = new URL(loginRequest.context);
            redirectUrl.searchParams.set("RelayState", relayState);
            return redirectUrl.toString();
          })()
        : undefined,
    post:
      binding === "post"
        ? {
            endpoint: loginRequest.entityEndpoint as string,
            value: loginRequest.context as string,
          }
        : undefined,
  };
}

export async function parseEnterpriseSamlLoginResponse(opts: {
  request: Request;
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
}) {
  ensureSamlifyValidator();
  const httpRequest = await readEnterpriseSamlHttpRequest(opts.request);
  const runtime = createEnterpriseSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
  });
  const parsed = (await runtime.sp.parseLoginResponse(
    runtime.idp as any,
    httpRequest.binding as any,
    {
      query: httpRequest.query,
      body: httpRequest.body,
    },
  )) as any;
  // Check for deprecated SAML algorithms and warn
  warnDeprecatedSamlAlgorithms(parsed);

  return {
    ...httpRequest,
    runtime,
    parsed,
    relayState: decodeEnterpriseSamlRelayStateOrThrow(
      httpRequest.relayState ?? null,
    ),
  };
}

const DEPRECATED_SAML_ALGORITHMS = new Set([
  // Signature algorithms
  "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
  "http://www.w3.org/2000/09/xmldsig#dsa-sha1",
  // Digest algorithms
  "http://www.w3.org/2000/09/xmldsig#sha1",
  // Key encryption
  "http://www.w3.org/2001/04/xmlenc#rsa-1_5",
  // Data encryption
  "http://www.w3.org/2001/04/xmlenc#tripledes-cbc",
]);

/**
 * Warn when the SAML response uses deprecated cryptographic algorithms
 * (SHA-1, RSA 1.5, 3DES). These are still accepted for compatibility
 * but should be flagged.
 */
function warnDeprecatedSamlAlgorithms(parsed: any) {
  try {
    const sigAlg =
      parsed?.extract?.signature?.signatureAlgorithm ??
      parsed?.extract?.response?.signatureAlgorithm;
    const digestAlg = parsed?.extract?.signature?.digestAlgorithm;

    if (sigAlg && DEPRECATED_SAML_ALGORITHMS.has(sigAlg)) {
      console.warn(
        `[convex-auth] SAML response uses deprecated signature algorithm: ${sigAlg}. ` +
          `Consider upgrading your IdP to use RSA-SHA256 or stronger.`,
      );
    }
    if (digestAlg && DEPRECATED_SAML_ALGORITHMS.has(digestAlg)) {
      console.warn(
        `[convex-auth] SAML response uses deprecated digest algorithm: ${digestAlg}. ` +
          `Consider upgrading your IdP to use SHA-256 or stronger.`,
      );
    }
  } catch {
    // Non-critical — don't break auth flow for algorithm check failures
  }
}

export function validateEnterpriseSamlLoginRelayState(opts: {
  relayState: EnterpriseSamlRelayState;
  source: EnterpriseSamlSource;
  inResponseTo?: string;
}) {
  if (
    opts.relayState.source.kind !== opts.source.kind ||
    opts.relayState.source.id !== opts.source.id ||
    opts.relayState.requestId !== opts.inResponseTo
  ) {
    throw new Error("SAML RelayState did not match the pending login request.");
  }
}

export async function parseEnterpriseSamlLogoutMessage(opts: {
  request: Request;
  rootUrl: string;
  source: EnterpriseSamlSource;
  config: unknown;
}) {
  ensureSamlifyValidator();
  const httpRequest = await readEnterpriseSamlHttpRequest(opts.request);
  const runtime = createEnterpriseSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
    relayState: httpRequest.relayState,
  });
  const parsedRequest = httpRequest.hasSamlRequest
    ? ((await runtime.sp.parseLogoutRequest(
        runtime.idp as any,
        httpRequest.binding as any,
        {
          query: httpRequest.query,
          body: httpRequest.body,
        },
      )) as any)
    : undefined;
  return {
    ...httpRequest,
    runtime,
    parsedRequest,
  };
}

export async function createEnterpriseOidcRuntime(opts: {
  rootUrl: string;
  enterpriseId: string;
  config: unknown;
}) {
  const oidc = getOidcConfig(opts.config);
  const providerId = enterpriseOidcProviderId(opts.enterpriseId);
  const urls = getEnterpriseOidcUrls({
    rootUrl: opts.rootUrl,
    enterpriseId: opts.enterpriseId,
  });
  const { provider, oauthConfig } = await createEnterpriseOidcProvider(
    oidc,
    urls.callbackUrl,
  );
  return {
    oidc,
    providerId,
    provider,
    oauthConfig,
    ...urls,
  };
}

export function profileFromSamlExtract(
  extract: any,
  mapping?: SAMLAttributeMapping,
) {
  const attributes =
    typeof extract?.attributes === "object" && extract.attributes !== null
      ? (extract.attributes as Record<string, unknown>)
      : {};
  const resolveFirst = (...keys: Array<string | undefined>) => {
    for (const key of keys) {
      if (!key) {
        continue;
      }
      const attribute = attributes[key];
      const value = Array.isArray(attribute) ? attribute[0] : attribute;
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  };
  const fieldResolvers = {
    email: () => resolveFirst(mapping?.email),
    name: () =>
      resolveFirst(mapping?.name) ??
      ([resolveFirst(mapping?.firstName), resolveFirst(mapping?.lastName)]
        .filter(Boolean)
        .join(" ") ||
        undefined),
    subject: () =>
      resolveFirst(mapping?.subject) ?? (extract?.nameID as string | undefined),
  } as const;
  const subject = fieldResolvers.subject() as string | undefined;
  if (subject === undefined) {
    throw new Error(
      "SAML profile is missing a subject. Configure `attributeMapping.subject` or ensure the assertion includes a NameID.",
    );
  }
  const email = fieldResolvers.email() as string | undefined;
  const name = fieldResolvers.name() as string | undefined;
  return {
    id: subject,
    email,
    emailVerified: typeof email === "string" ? true : undefined,
    name,
    samlAttributes: attributes,
    samlSessionIndex: extract?.sessionIndex?.SessionIndex as string | undefined,
  };
}

export function parseScimPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const [api, auth, enterprise, enterpriseId, protocol, version, ...rest] =
    parts;

  if (
    api !== "api" ||
    auth !== "auth" ||
    enterprise !== "enterprise" ||
    !enterpriseId ||
    enterpriseId === "setup" ||
    protocol !== "scim" ||
    version !== "v2"
  ) {
    return {
      enterpriseId: "",
      resource: "",
      resourceId: undefined,
    };
  }

  return {
    enterpriseId,
    resource: rest[0] ?? "",
    resourceId: rest[1],
  };
}

export function parseScimListRequest(url: URL): ScimListRequest {
  const startIndex = Math.max(
    1,
    Number(url.searchParams.get("startIndex") ?? "1"),
  );
  const count = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("count") ?? "100")),
  );
  const filterParam = url.searchParams.get("filter");
  const filter = filterParam
    ? (() => {
        const match = filterParam.match(/^([A-Za-z0-9_.]+)\s+eq\s+"([^"]+)"$/);
        if (!match) {
          throw new Error("Unsupported SCIM filter.");
        }
        return { attribute: match[1]!, value: match[2]! };
      })()
    : undefined;
  return { startIndex, count, filter };
}

export function scimJson(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers({
    "Content-Type": "application/scim+json",
  });
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      responseHeaders.set(key, value);
    });
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

export function scimError(status: number, scimType: string, detail: string) {
  return scimJson(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      scimType,
      detail,
    },
    status,
  );
}

export function serializeScimUser(args: {
  id: string;
  user: Record<string, any>;
  externalId?: string;
  active?: boolean;
  location?: string;
}) {
  return {
    schemas: [SCIM_USER_SCHEMA_ID],
    id: args.id,
    externalId: args.externalId,
    meta: {
      resourceType: "User",
      location: args.location,
    },
    userName: args.user.email ?? args.user.phone ?? args.user.name ?? args.id,
    active: args.active ?? true,
    name:
      args.user.name !== undefined ? { formatted: args.user.name } : undefined,
    emails:
      typeof args.user.email === "string"
        ? [{ value: args.user.email, primary: true }]
        : undefined,
    phoneNumbers:
      typeof args.user.phone === "string"
        ? [{ value: args.user.phone, primary: true }]
        : undefined,
    displayName: args.user.name,
  };
}

export function serializeScimGroup(args: {
  id: string;
  group: Record<string, any>;
  externalId?: string;
  members?: Array<{ value: string; display?: string }>;
  location?: string;
}) {
  return {
    schemas: [SCIM_GROUP_SCHEMA_ID],
    id: args.id,
    externalId: args.externalId,
    meta: {
      resourceType: "Group",
      location: args.location,
    },
    displayName: args.group.name ?? args.id,
    members: args.members ?? [],
  };
}
