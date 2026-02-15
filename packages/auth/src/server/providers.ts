import {
  AuthProviderConfig,
  AuthProviderMaterializedConfig,
  ConvexAuthConfig,
  OAuthMaterializedConfig,
} from "./types";
import { isOAuthProvider, type OAuthProviderInstance } from "../providers/oauth";

// ============================================================================
// Provider class detection
// ============================================================================

/** Check if something is a new-style class provider with `_toMaterialized()`. */
function isClassProvider(
  provider: any,
): provider is { _toMaterialized(): AuthProviderMaterializedConfig } {
  return (
    typeof provider === "object" &&
    provider !== null &&
    typeof provider._toMaterialized === "function"
  );
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve raw provider configs into materialized form and apply defaults.
 *
 * @internal
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
    extraProviders: materializeProviders(extraProviders),
  };
}

/**
 * Materialize a single provider config into its runtime form.
 *
 * @internal
 */
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

function materializeAndDefaultProviders(config_: ConvexAuthConfig) {
  const allProviders: AuthProviderMaterializedConfig[] = [];

  for (const raw of config_.providers) {
    if (isOAuthProvider(raw)) {
      allProviders.push(materializeOAuthProvider(raw));
    } else if (isClassProvider(raw)) {
      allProviders.push(raw._toMaterialized());
    } else {
      // Factory function or plain config object
      const resolved = typeof raw === "function" ? raw() : (raw as any);
      // Merge `options` into the provider (backward compat with factory-style
      // providers that store user overrides in an `options` field).
      const merged = resolved.options
        ? { ...resolved, ...resolved.options }
        : resolved;
      allProviders.push(merged as AuthProviderMaterializedConfig);
    }
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

/**
 * Materialize an Arctic-based `OAuthProviderInstance` into the runtime config.
 */
function materializeOAuthProvider(
  instance: OAuthProviderInstance,
): OAuthMaterializedConfig {
  return {
    id: instance.id,
    type: "oauth",
    provider: instance.provider,
    scopes: instance.scopes,
    profile: instance.profile,
  };
}
