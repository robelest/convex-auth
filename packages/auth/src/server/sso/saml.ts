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

import type { SAMLAttributeMapping } from "../types";
import { getSamlConfig } from "./config";
import type {
  GroupSamlHttpRequest,
  GroupSamlRelayState,
  GroupSamlSource,
  ParsedSamlMetadata,
} from "./shared";
import { asRecord, getGroupSamlUrls } from "./shared";

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
export function encodeGroupSamlRelayState(
  value: GroupSamlRelayState,
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

  const nameIdFormats = [...source.matchAll(
    /<(?:[A-Za-z0-9_.-]+:)?NameIDFormat>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?NameIDFormat>/gi,
  )]
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
  const saml = getSamlConfig(opts.config);
  const sp = asRecord(saml.sp) ?? {};
  const urls = getGroupSamlUrls({
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
    urls: getGroupSamlUrls({ rootUrl: opts.rootUrl, source: opts.source }),
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
  const binding = runtime.saml.idp.sso?.redirect ? "redirect" : "post";
  const loginRequest = runtime.sp.createLoginRequest(
    runtime.idp,
    binding as any,
  ) as any;
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
  const runtime = createGroupConnectionSamlRuntime({
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
function warnWeakSamlAlgorithms(parsed: any) {
  try {
    const sigAlg =
      parsed?.extract?.signature?.signatureAlgorithm ??
      parsed?.extract?.response?.signatureAlgorithm;
    const digestAlg = parsed?.extract?.signature?.digestAlgorithm;

    if (sigAlg && WEAK_SAML_ALGORITHMS.has(sigAlg)) {
      console.warn(
        `[convex-auth] SAML response uses weak signature algorithm: ${sigAlg}. ` +
          `Consider upgrading your IdP to use RSA-SHA256 or stronger.`,
      );
    }
    if (digestAlg && WEAK_SAML_ALGORITHMS.has(digestAlg)) {
      console.warn(
        `[convex-auth] SAML response uses weak digest algorithm: ${digestAlg}. ` +
          `Consider upgrading your IdP to use SHA-256 or stronger.`,
      );
    }
  } catch {
    // Non-critical — don't break auth flow for algorithm check failures
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

/** @internal */
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
