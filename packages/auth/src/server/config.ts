import {
  AuthAuthorizationConfig,
  AuthProviderConfig,
  AuthProviderMaterializedConfig,
  AuthTelemetryConfig,
  ConvexAuthConfig,
} from "./types";

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve raw provider configs into materialized form and apply defaults.
 */
export function configDefaults(config_: ConvexAuthConfig) {
  const config = materializeAndDefaultProviders(config_);
  // Collect extra providers from credentials providers
  const extraProviders = config.providers
    .filter((p) => p.type === "credentials")
    .map((p) => p.extraProviders)
    .flat()
    .filter((p) => p !== undefined);
  return {
    ...config,
    authorization: normalizeAuthorizationConfig(config.authorization),
    telemetry: normalizeTelemetryConfig(config.telemetry),
    extraProviders: materializeProviders(extraProviders),
  };
}

/**
 * List available provider IDs for error messages.
 */
export function listAvailableProviders(
  config: ReturnType<typeof configDefaults>,
  allowExtraProviders: boolean,
) {
  const availableProviders = config.providers
    .concat(allowExtraProviders ? config.extraProviders : [])
    .map((provider) => `\`${provider.id}\``);
  return availableProviders.length > 0
    ? availableProviders.join(", ")
    : "no providers have been configured";
}

// ============================================================================
// Internal helpers
// ============================================================================

function materializeProviders(providers: AuthProviderConfig[]) {
  const config = { providers, component: {} } as unknown as ConvexAuthConfig;
  materializeAndDefaultProviders(config);
  return config.providers as AuthProviderMaterializedConfig[];
}

function materializeProviderConfig(raw: AuthProviderConfig): AuthProviderMaterializedConfig {
  const resolved = typeof raw === "function" ? raw() : raw;
  const merged =
    "options" in resolved && typeof resolved.options === "object" && resolved.options !== null
      ? { ...resolved, ...resolved.options }
      : resolved;
  return merged as AuthProviderMaterializedConfig;
}

function materializeAndDefaultProviders(config_: ConvexAuthConfig) {
  const allProviders: AuthProviderMaterializedConfig[] = [];

  for (const raw of config_.providers) {
    allProviders.push(materializeProviderConfig(raw));
  }

  const config = { ...config_, providers: allProviders };

  // Set phone provider API key from env
  config.providers.forEach((provider) => {
    if (provider.type === "phone") {
      const ID = provider.id.toUpperCase().replace(/-/g, "_");
      provider.apiKey ??= process.env[`AUTH_${ID}_KEY`];
    }
  });

  return config;
}

function normalizeAuthorizationConfig(
  authorization: ConvexAuthConfig["authorization"],
): AuthAuthorizationConfig {
  const roles = Object.fromEntries(
    Object.entries(authorization?.roles ?? {}).map(([roleId, role]) => [
      roleId,
      {
        ...(role.label ? { label: role.label } : {}),
        grants: Array.from(new Set(role.grants)).sort(),
      },
    ]),
  );
  return { roles };
}

function normalizeTelemetryConfig(telemetry: ConvexAuthConfig["telemetry"]): AuthTelemetryConfig {
  const normalized: AuthTelemetryConfig = {
    includeIdentity: telemetry?.includeIdentity ?? "none",
    identityFields: telemetry?.identityFields ?? {},
    ...(telemetry?.hashIdentity ? { hashIdentity: telemetry.hashIdentity } : {}),
  };

  if (normalized.includeIdentity === "hashed" && normalized.hashIdentity === undefined) {
    throw new Error(
      'Convex Auth telemetry with `includeIdentity: "hashed"` requires a `hashIdentity` function.',
    );
  }

  return normalized;
}
