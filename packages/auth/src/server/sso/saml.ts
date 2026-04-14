import {
  decodeBase64urlIgnorePadding,
  encodeBase64urlNoPadding,
} from "@oslojs/encoding";
import {
  Constants,
  IdentityProvider,
  ServiceProvider,
  setSchemaValidator,
} from "@robelest/samlify";

import { log } from "../log";
import type { SAMLAttributeMapping } from "../types";
import { getSamlConfig } from "./config";
import { finalizeNormalizedProfile, normalizeStringArray } from "./profile";
import type {
  GroupSamlHttpRequest,
  GroupSamlRelayState,
  GroupSamlSource,
  ParsedSamlMetadata,
} from "./shared";
import { asRecord, getGroupSamlUrls } from "./shared";

type SamlIdpConfig = {
  metadataXml?: string;
  entityId?: string;
  issuer?: string;
  metadataUrl?: string;
  sso?: {
    redirect?: unknown;
  };
};

type SamlSpConfig = {
  entityId?: string;
  acsUrl?: string;
  sloUrl?: string;
  signingCert?: string | string[];
  encryptCert?: string | string[];
  privateKey?: string;
  privateKeyPass?: string;
  encPrivateKey?: string;
  encPrivateKeyPass?: string;
};

type SamlIdentityProvider = ReturnType<typeof IdentityProvider>;
type SamlServiceProvider = ReturnType<typeof createSamlServiceProvider> & {
  createLoginRequest(
    idp: SamlIdentityProvider,
    binding: "redirect" | "post",
  ): SamlLoginRequest | PostBindingContext | SimpleSignBindingContext;
  parseLoginResponse(
    idp: SamlIdentityProvider,
    binding: GroupSamlHttpRequest["binding"],
    request: ESamlHttpRequest,
  ): Promise<SamlParsedFlow>;
  parseLogoutRequest(
    idp: SamlIdentityProvider,
    binding: GroupSamlHttpRequest["binding"],
    request: ESamlHttpRequest,
  ): Promise<SamlParsedFlow>;
  createLogoutResponse(
    idp: SamlIdentityProvider,
    extract: SamlParsedFlow["extract"],
    binding: GroupSamlHttpRequest["binding"],
    relayState: string,
  ): { context: string; entityEndpoint: string };
};

type SamlConfigShape = {
  enabled?: boolean;
  request?: {
    signAuthnRequests?: boolean;
    nameIdFormat?: string;
    forceAuthn?: boolean;
    authnContextClassRefs?: string[];
  };
  security?: SamlSecurityConfig;
  profile?: {
    mapping?: SAMLAttributeMapping;
    extraFields?: Record<string, string>;
  };
  idp?: SamlIdpConfig;
  serviceProvider?: SamlSpConfig;
};

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

/** @internal */
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

/** @internal */
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

/** @internal */
export function encodeGroupSamlRelayState(value: GroupSamlRelayState) {
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

/** @internal */
export function decodeGroupSamlRelayStateOrThrow(
  value: string | null,
): GroupSamlRelayState {
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
  if (kind !== "connection" || id.length === 0) {
    throw new Error("Invalid group connection SAML source.");
  }
  return {
    source: { kind, id } as GroupSamlSource,
    signature: decoded.signature,
    requestId: decoded.requestId,
    state: decoded.state,
    redirectTo:
      typeof decoded.redirectTo === "string" ? decoded.redirectTo : undefined,
  };
}

/** @internal */
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

/** @internal */
export async function readGroupConnectionSamlHttpRequest(
  request: Request,
): Promise<GroupSamlHttpRequest> {
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

function getSamlSecurityConfig(config: unknown): SamlSecurityConfig {
  const saml = getSamlConfig(config) as SamlConfigShape;
  return (asRecord(saml.security) ?? {}) as SamlSecurityConfig;
}

/** @internal */
export function parseSamlIdpMetadata(metadata: string): ParsedSamlMetadata {
  const source = typeof metadata === "string" ? metadata : String(metadata);
  const entityId =
    source.match(/<[^>]*EntityDescriptor\b[^>]*\bentityID="([^"]+)"/i)?.[1] ??
    null;
  if (!entityId) {
    throw new Error("SAML metadata is missing EntityDescriptor@entityID.");
  }

  const parseAttributes = (source: string) => {
    const attributes: Record<string, string> = {};
    for (const match of source.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
      attributes[match[1]] = match[2];
    }
    return attributes;
  };

  const readServiceBindings = (tagName: string) => {
    const bindings: { redirect?: string; post?: string } = {};
    const pattern = new RegExp(
      `<(?:[A-Za-z0-9_.-]+:)?${tagName}\\b([^>]*)\\/?>(?:<\\/(?:[A-Za-z0-9_.-]+:)?${tagName}>)?`,
      "gi",
    );
    for (const match of source.matchAll(pattern)) {
      const attrs = parseAttributes(match[1] ?? "");
      const binding = attrs.Binding ?? attrs.binding;
      const location = attrs.Location ?? attrs.location;
      if (!binding || !location) {
        continue;
      }
      if (binding.includes("HTTP-Redirect")) {
        bindings.redirect = location;
      }
      if (binding.includes("HTTP-POST")) {
        bindings.post = location;
      }
    }
    return bindings;
  };

  const readCertificates = (use: "signing" | "encryption") => {
    const certs: string[] = [];
    const blockPattern = new RegExp(
      `<(?:[A-Za-z0-9_.-]+:)?KeyDescriptor\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?KeyDescriptor>`,
      "gi",
    );
    for (const match of source.matchAll(blockPattern)) {
      const attrs = parseAttributes(match[1] ?? "");
      const descriptorUse = (attrs.use ?? attrs.Use ?? "signing").toLowerCase();
      if (descriptorUse !== use) {
        continue;
      }
      for (const certMatch of (match[2] ?? "").matchAll(
        /<(?:[A-Za-z0-9_.-]+:)?X509Certificate>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?X509Certificate>/gi,
      )) {
        const certificate = certMatch[1]?.replace(/\s+/g, "").trim();
        if (certificate) {
          certs.push(certificate);
        }
      }
    }
    if (certs.length === 0) {
      return null;
    }
    return certs.length === 1 ? certs[0] : certs;
  };

  const nameIdFormats = [
    ...source.matchAll(
      /<(?:[A-Za-z0-9_.-]+:)?NameIDFormat>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?NameIDFormat>/gi,
    ),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return {
    entityId,
    issuer: entityId,
    sso: readServiceBindings("SingleSignOnService"),
    slo: readServiceBindings("SingleLogoutService"),
    signingCert: readCertificates("signing"),
    encryptionCert: readCertificates("encryption"),
    nameIdFormats,
    wantsSignedAuthnRequests: /WantAuthnRequestsSigned="true"/i.test(source),
  };
}

/** @internal */
export function enforceSamlMetadataSize(opts: {
  metadataXml: string;
  config: unknown;
}) {
  const maxMetadataSize = getSamlSecurityConfig(opts.config).maxMetadataSize;
  if (
    typeof maxMetadataSize === "number" &&
    maxMetadataSize > 0 &&
    opts.metadataXml.length > maxMetadataSize
  ) {
    throw new Error("SAML metadata exceeds the configured size limit.");
  }
}

/** @internal */
export function parseSamlIdpMetadataChecked(opts: {
  metadataXml: string;
  config: unknown;
}) {
  enforceSamlMetadataSize(opts);
  return parseSamlIdpMetadata(opts.metadataXml);
}

/** @internal */
export function enforceSamlResponseSize(opts: {
  request: GroupSamlHttpRequest;
  config: unknown;
}) {
  const maxResponseSize = getSamlSecurityConfig(opts.config).maxResponseSize;
  if (typeof maxResponseSize !== "number" || maxResponseSize <= 0) {
    return;
  }
  const encoded =
    opts.request.body.SAMLResponse ?? opts.request.query.SAMLResponse;
  if (typeof encoded === "string" && encoded.length > maxResponseSize) {
    throw new Error("SAML response exceeds the configured size limit.");
  }
}

/** @internal */
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

/** @internal */
export function createGroupConnectionSamlMetadataXml(opts: {
  rootUrl: string;
  source: GroupSamlSource;
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

/** @internal */
export function getSamlServiceProviderOptions(opts: {
  rootUrl: string;
  source: GroupSamlSource;
  config: unknown;
  overrides?: {
    entityId?: string;
    acsUrl?: string;
    sloUrl?: string;
  };
  relayState?: string;
}) {
  const saml = getSamlConfig(opts.config) as SamlConfigShape;
  const sp = (asRecord(saml.serviceProvider) ?? {}) as SamlSpConfig;
  const urls = getGroupSamlUrls({
    rootUrl: opts.rootUrl,
    source: opts.source,
  });
  return {
    entityId: opts.overrides?.entityId ?? sp.entityId ?? urls.metadataUrl,
    acsUrl: opts.overrides?.acsUrl ?? sp.acsUrl ?? urls.acsUrl,
    sloUrl: opts.overrides?.sloUrl ?? sp.sloUrl ?? urls.sloUrl,
    relayState: opts.relayState,
    authnRequestsSigned: saml.request?.signAuthnRequests,
    signingCert: sp.signingCert,
    encryptCert: sp.encryptCert,
    privateKey: sp.privateKey,
    privateKeyPass: sp.privateKeyPass,
    encPrivateKey: sp.encPrivateKey,
    encPrivateKeyPass: sp.encPrivateKeyPass,
  };
}

/** @internal */
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

/** @internal */
export function createGroupConnectionSamlRuntime(opts: {
  rootUrl: string;
  source: GroupSamlSource;
  config: unknown;
  relayState?: string;
  overrides?: {
    entityId?: string;
    acsUrl?: string;
    sloUrl?: string;
  };
}) {
  const saml = getSamlConfig(opts.config) as SamlConfigShape;
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
    sp: createSamlServiceProvider(spOptions) as SamlServiceProvider,
    idp: IdentityProvider({
      metadata: saml.idp.metadataXml,
    }) as SamlIdentityProvider,
    urls: getGroupSamlUrls({ rootUrl: opts.rootUrl, source: opts.source }),
  };
}

type SamlLoginRequest = BindingContext & {
  entityEndpoint?: string;
};

type BindingContext = {
  context: string;
  id: string;
};

type PostBindingContext = BindingContext & {
  relayState?: string;
  entityEndpoint: string;
  type: string;
};

type SimpleSignBindingContext = PostBindingContext & {
  sigAlg?: string;
  signature?: string;
  keyInfo?: string;
};

type ESamlHttpRequest = {
  query: Record<string, string>;
  body: Record<string, string>;
};

type FlowResult = {
  samlContent: string;
  extract: SamlParsedExtract;
  sigAlg?: string | null;
};

type SamlParsedExtract = {
  signature?: {
    signatureAlgorithm?: string;
    digestAlgorithm?: string;
  };
  conditions?: {
    notBefore?: string;
    notOnOrAfter?: string;
  };
  response?: {
    signatureAlgorithm?: string;
    inResponseTo?: string;
  };
  attributes?: Record<string, unknown>;
  nameID?: string;
  sessionIndex?: { SessionIndex?: string };
};

type SamlParsedFlow = FlowResult & {
  extract?: SamlParsedExtract;
};

type SamlSecurityConfig = {
  requireSignedAssertions?: boolean;
  requireTimestamps?: boolean;
  clockSkewSeconds?: number;
  weakAlgorithmHandling?: "warn" | "reject";
  maxMetadataSize?: number;
  maxResponseSize?: number;
};

function verifySamlTimeWindow(
  notBefore: string | undefined,
  notOnOrAfter: string | undefined,
  clockSkewSeconds: number,
) {
  const now = Date.now();
  const drift = clockSkewSeconds * 1000;
  if (notBefore) {
    const notBeforeTime = new Date(notBefore).getTime();
    if (Number.isFinite(notBeforeTime) && now < notBeforeTime - drift) {
      throw new Error("SAML assertion is not yet valid.");
    }
  }
  if (notOnOrAfter) {
    const notOnOrAfterTime = new Date(notOnOrAfter).getTime();
    if (Number.isFinite(notOnOrAfterTime) && now >= notOnOrAfterTime + drift) {
      throw new Error("SAML assertion has expired.");
    }
  }
}

/** @internal */
export function enforceGroupConnectionSamlSecurity(opts: {
  extract: SamlParsedExtract | undefined;
  config: unknown;
}) {
  enforceSamlAlgorithmPolicy(opts);
  const saml = getSamlConfig(opts.config) as SamlConfigShape;
  const security = (asRecord(saml.security) ?? {}) as SamlSecurityConfig;
  const conditions = opts.extract?.conditions;

  if (
    security.requireSignedAssertions === true &&
    typeof opts.extract?.signature?.signatureAlgorithm !== "string"
  ) {
    throw new Error("SAML assertion must be signed.");
  }

  if (security.requireTimestamps === true) {
    if (!conditions?.notBefore && !conditions?.notOnOrAfter) {
      throw new Error("SAML assertion missing required timestamp conditions.");
    }
  }

  if (conditions?.notBefore || conditions?.notOnOrAfter) {
    verifySamlTimeWindow(
      conditions.notBefore,
      conditions.notOnOrAfter,
      security.clockSkewSeconds ?? 300,
    );
  }
}

function toSamlHttpRequest(request: GroupSamlHttpRequest): ESamlHttpRequest {
  return {
    query: request.query,
    body: request.body,
  };
}

/** @internal */
export function createGroupConnectionSamlSignInRequest(opts: {
  rootUrl: string;
  source: GroupSamlSource;
  config: unknown;
  state: string;
  signature: string;
  redirectTo?: string;
}) {
  const runtime = createGroupConnectionSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
  });
  const binding = runtime.saml.idp?.sso?.redirect ? "redirect" : "post";
  const loginRequest = runtime.sp.createLoginRequest(runtime.idp, binding) as
    | SamlLoginRequest
    | PostBindingContext
    | SimpleSignBindingContext;
  const relayState = encodeGroupSamlRelayState({
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

/** @internal */
export async function parseGroupConnectionSamlLoginResponse(opts: {
  request: Request;
  rootUrl: string;
  source: GroupSamlSource;
  config: unknown;
}) {
  ensureSamlifyValidator();
  const httpRequest = await readGroupConnectionSamlHttpRequest(opts.request);
  enforceSamlResponseSize({ request: httpRequest, config: opts.config });
  const runtime = createGroupConnectionSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
  });
  const parsed = (await runtime.sp.parseLoginResponse(
    runtime.idp,
    httpRequest.binding,
    toSamlHttpRequest(httpRequest),
  )) as SamlParsedFlow;
  // Check for weak SAML algorithms and warn.
  warnWeakSamlAlgorithms(parsed);

  return {
    ...httpRequest,
    runtime,
    parsed,
    relayState: decodeGroupSamlRelayStateOrThrow(
      httpRequest.relayState ?? null,
    ),
  };
}

const WEAK_SAML_ALGORITHMS = new Set([
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
 * Warn when the SAML response uses weak cryptographic algorithms
 * such as SHA-1, RSA 1.5, or 3DES.
 */
function warnWeakSamlAlgorithms(parsed: SamlParsedFlow) {
  try {
    const sigAlg =
      parsed?.extract?.signature?.signatureAlgorithm ??
      parsed?.extract?.response?.signatureAlgorithm;
    const digestAlg = parsed?.extract?.signature?.digestAlgorithm;

    if (sigAlg && WEAK_SAML_ALGORITHMS.has(sigAlg)) {
      log(
        "WARN",
        `[convex-auth] SAML response uses weak signature algorithm: ${sigAlg}. ` +
          `Consider upgrading your IdP to use RSA-SHA256 or stronger.`,
      );
    }
    if (digestAlg && WEAK_SAML_ALGORITHMS.has(digestAlg)) {
      log(
        "WARN",
        `[convex-auth] SAML response uses weak digest algorithm: ${digestAlg}. ` +
          `Consider upgrading your IdP to use SHA-256 or stronger.`,
      );
    }
  } catch {
    // Non-critical — don't break auth flow for algorithm check failures
  }
}

/** @internal */
export function enforceSamlAlgorithmPolicy(opts: {
  extract: SamlParsedExtract | undefined;
  config: unknown;
}) {
  const handling = getSamlSecurityConfig(opts.config).weakAlgorithmHandling;
  if (handling !== "reject") {
    return;
  }
  const sigAlg =
    opts.extract?.signature?.signatureAlgorithm ??
    opts.extract?.response?.signatureAlgorithm;
  const digestAlg = opts.extract?.signature?.digestAlgorithm;
  if (
    (sigAlg && WEAK_SAML_ALGORITHMS.has(sigAlg)) ||
    (digestAlg && WEAK_SAML_ALGORITHMS.has(digestAlg))
  ) {
    throw new Error(
      "SAML response uses a rejected weak cryptographic algorithm.",
    );
  }
}

/** @internal */
export function validateGroupConnectionSamlLoginRelayState(opts: {
  relayState: GroupSamlRelayState;
  source: GroupSamlSource;
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

/** @internal */
export async function parseGroupConnectionSamlLogoutMessage(opts: {
  request: Request;
  rootUrl: string;
  source: GroupSamlSource;
  config: unknown;
}) {
  ensureSamlifyValidator();
  const httpRequest = await readGroupConnectionSamlHttpRequest(opts.request);
  const runtime = createGroupConnectionSamlRuntime({
    rootUrl: opts.rootUrl,
    source: opts.source,
    config: opts.config,
    relayState: httpRequest.relayState,
  });
  const parsedRequest = httpRequest.hasSamlRequest
    ? ((await runtime.sp.parseLogoutRequest(
        runtime.idp,
        httpRequest.binding,
        toSamlHttpRequest(httpRequest),
      )) as SamlParsedFlow)
    : undefined;
  return {
    ...httpRequest,
    runtime,
    parsedRequest,
  };
}

/** @internal */
export function profileFromSamlExtract(
  extract: SamlParsedExtract | undefined,
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
    groups: () => normalizeStringArray(resolveFirst(mapping?.groups)),
    name: () =>
      resolveFirst(mapping?.name) ??
      ([resolveFirst(mapping?.firstName), resolveFirst(mapping?.lastName)]
        .filter(Boolean)
        .join(" ") ||
        undefined),
    roles: () => normalizeStringArray(resolveFirst(mapping?.roles)),
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
  const groups = fieldResolvers.groups() as string[] | undefined;
  const name = fieldResolvers.name() as string | undefined;
  const roles = fieldResolvers.roles() as string[] | undefined;
  return finalizeNormalizedProfile({
    id: subject,
    email,
    emailVerified: typeof email === "string" ? true : undefined,
    groups,
    name,
    roles,
    samlAttributes: attributes,
    samlSessionIndex: extract?.sessionIndex?.SessionIndex as string | undefined,
  });
}
