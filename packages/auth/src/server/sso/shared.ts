/** @internal */
export type ParsedSamlMetadata = {
  entityId: string;
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
export type GroupSamlSource = { kind: "connection"; id: string };

/** @internal */
export type GroupSamlRelayState = {
  source: GroupSamlSource;
  signature: string;
  requestId: string;
  state: string;
  redirectTo?: string;
};

/** @internal */
export type GroupSamlUrls = {
  metadataUrl: string;
  acsUrl: string;
  sloUrl?: string;
};

/** @internal */
export type GroupSamlLoadedSource = {
  source: GroupSamlSource;
  config: unknown;
  status?: string;
};

/** @internal */
export type GroupSamlHttpRequest = {
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
export const GROUP_OIDC_PROVIDER_PREFIX = "group:oidc:";
/** @internal */
export const GROUP_SAML_PROVIDER_PREFIX = "group:saml:";

/** @internal */
export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, "");
}

/** @internal */
export function groupOidcProviderId(connectionId: string): string {
  return `${GROUP_OIDC_PROVIDER_PREFIX}${connectionId}`;
}

/** @internal */
export function groupSamlProviderId(connectionId: string): string {
  return `${GROUP_SAML_PROVIDER_PREFIX}${connectionId}`;
}

/** @internal */
export function getGroupSamlUrls(opts: {
  rootUrl: string;
  source: GroupSamlSource;
}): GroupSamlUrls {
  const root = opts.rootUrl.replace(/\/$/, "");
  const metadataBase = `${root}/api/auth/connections/${opts.source.id}/saml/metadata`;
  const acsBase = `${root}/api/auth/connections/${opts.source.id}/saml/acs`;
  const sloBase = `${root}/api/auth/connections/${opts.source.id}/saml/slo`;
  return {
    metadataUrl: metadataBase,
    acsUrl: acsBase,
    sloUrl: sloBase,
  };
}

/** @internal */
export function getGroupOidcUrls(opts: {
  rootUrl: string;
  connectionId: string;
}) {
  const root = opts.rootUrl.replace(/\/$/, "");
  return {
    signInUrl: `${root}/api/auth/connections/${opts.connectionId}/oidc/signin`,
    callbackUrl: `${root}/api/auth/connections/${opts.connectionId}/oidc/callback`,
  };
}

/** @internal */
export function isGroupSamlSourceActive(
  source: GroupSamlLoadedSource,
) {
  return source.status === "active";
}

/** @internal */
export function isGroupProviderId(providerId: string): boolean {
  return (
    providerId.startsWith(GROUP_OIDC_PROVIDER_PREFIX) ||
    providerId.startsWith(GROUP_SAML_PROVIDER_PREFIX)
  );
}

export const asRecord = (value: unknown) =>
  typeof value === "object" && value !== null
    ? (value as Record<string, any>)
    : null;
