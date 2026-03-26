import { asRecord } from "./shared";

const getProtocolConfig = (config: unknown, protocol: "oidc" | "saml") => {
  const base = asRecord(config);
  const direct = base?.[protocol];
  const viaProtocols = asRecord(base?.protocols)?.[protocol];
  return asRecord(direct) ?? asRecord(viaProtocols) ?? {};
};

/** @internal */
export function getOidcConfig(config: unknown): Record<string, any> {
  return getProtocolConfig(config, "oidc");
}

/** @internal */
export function getPublicOidcConfig(config: unknown): Record<string, any> {
  const oidc = getOidcConfig(config);
  const { clientSecret: _clientSecret, ...publicOidc } = oidc;
  return publicOidc;
}

/** @internal */
export function withOidcSecretState(
  config: Record<string, any>,
  hasClientSecret: boolean,
) {
  return {
    ...config,
    hasClientSecret,
  };
}

/** @internal */
export function getSamlConfig(config: unknown): Record<string, any> {
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
