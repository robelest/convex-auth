import { asRecord } from "./shared";

const getProtocolConfig = (config: unknown, protocol: "oidc" | "saml") => {
  const base = asRecord(config);
  const direct = base?.[protocol];
  const viaProtocols = asRecord(base?.protocols)?.[protocol];
  return asRecord(direct) ?? asRecord(viaProtocols) ?? {};
};

/** @internal */
export function getOidcConfig(config: unknown): Record<string, unknown> {
  return getProtocolConfig(config, "oidc");
}

/** @internal */
export function getPublicOidcConfig(config: unknown): Record<string, unknown> {
  const oidc = getOidcConfig(config);
  const client =
    typeof oidc.client === "object" && oidc.client !== null
      ? (oidc.client as Record<string, unknown>)
      : undefined;
  const publicOidc = {
    ...oidc,
    ...(client
      ? {
          client: {
            ...client,
            secret: undefined,
          },
        }
      : {}),
  };
  return publicOidc;
}

/** @internal */
export function withOidcSecretState(config: Record<string, unknown>, hasClientSecret: boolean) {
  return {
    ...config,
    hasClientSecret,
  };
}

/** @internal */
export function getSamlConfig(config: unknown): Record<string, unknown> {
  return getProtocolConfig(config, "saml");
}

/** @internal */
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
