/** @internal */
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

/** @internal */
export type EnterpriseSamlSource = { kind: "enterprise"; id: string };

/** @internal */
export type EnterpriseSamlRelayState = {
  source: EnterpriseSamlSource;
  signature: string;
  requestId: string;
  state: string;
  redirectTo?: string;
};

/** @internal */
export type EnterpriseSamlUrls = {
  metadataUrl: string;
  acsUrl: string;
  sloUrl?: string;
};

/** @internal */
export type EnterpriseSamlLoadedSource = {
  source: EnterpriseSamlSource;
  config: unknown;
  status?: string;
};

/** @internal */
export type EnterpriseSamlHttpRequest = {
  url: URL;
  body: Record<string, string>;
  query: Record<string, string>;
  binding: "redirect" | "post";
  relayState?: string;
  hasSamlRequest: boolean;
  hasSamlResponse: boolean;
};

/** @internal */
export type ScimListRequest = {
  startIndex: number;
  count: number;
  filter?: { attribute: string; value: string };
};

/** @internal */
export const SCIM_USER_SCHEMA_ID = "urn:ietf:params:scim:schemas:core:2.0:User";
/** @internal */
export const SCIM_GROUP_SCHEMA_ID =
  "urn:ietf:params:scim:schemas:core:2.0:Group";

/** @internal */
export const ENTERPRISE_OIDC_PROVIDER_PREFIX = "enterprise:oidc:";
/** @internal */
export const ENTERPRISE_SAML_PROVIDER_PREFIX = "enterprise:saml:";

/** @internal */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

/** @internal */
export function enterpriseOidcProviderId(enterpriseId: string): string {
  return `${ENTERPRISE_OIDC_PROVIDER_PREFIX}${enterpriseId}`;
}

/** @internal */
export function enterpriseSamlProviderId(enterpriseId: string): string {
  return `${ENTERPRISE_SAML_PROVIDER_PREFIX}${enterpriseId}`;
}

/** @internal */
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

/** @internal */
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

/** @internal */
export function isEnterpriseSamlSourceActive(
  source: EnterpriseSamlLoadedSource,
) {
  return source.status === "active";
}

/** @internal */
export function isEnterpriseProviderId(providerId: string): boolean {
  return (
    providerId.startsWith(ENTERPRISE_OIDC_PROVIDER_PREFIX) ||
    providerId.startsWith(ENTERPRISE_SAML_PROVIDER_PREFIX)
  );
}

export const asRecord = (value: unknown) =>
  typeof value === "object" && value !== null
    ? (value as Record<string, any>)
    : null;
