import {
  AuthAuthorizationConfig,
  AuthProviderConfig,
  AuthProviderMaterializedConfig,
  ConvexAuthConfig,
} from "./types";

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve raw provider configs into materialized form and apply defaults.
 *
 * @internal
 */
/** @internal */
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
    extraProviders: materializeProviders(extraProviders),
  };
}

/**
 * Materialize a single provider config into its runtime form.
 *
 * @internal
 */
/** @internal */
export function materializeProvider(provider: AuthProviderConfig) {
  const config = { providers: [provider], component: {} as any };
  materializeAndDefaultProviders(config);
  return config.providers[0] as AuthProviderMaterializedConfig;
}

/**
 * List available provider IDs for error messages.
 *
 * @internal
 */
/** @internal */
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
  const config = { providers, component: {} as any };
  materializeAndDefaultProviders(config);
  return config.providers as AuthProviderMaterializedConfig[];
}

function materializeProviderConfig(
  raw: AuthProviderConfig,
): AuthProviderMaterializedConfig {
  const resolved = typeof raw === "function" ? raw() : (raw as any);
  const merged = resolved.options
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
