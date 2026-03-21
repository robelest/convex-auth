import {
  isOAuthProvider,
  type OAuthProviderInstance,
} from "../providers/oauth";
import {
  AuthProviderConfig,
  AuthProviderMaterializedConfig,
  ConvexAuthConfig,
  OAuthMaterializedConfig,
} from "./types";

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

type ProviderMaterializationDispatch =
  | { tag: "oauth"; raw: OAuthProviderInstance }
  | {
      tag: "class";
      raw: { _toMaterialized(): AuthProviderMaterializedConfig };
    }
  | { tag: "factoryOrObject"; raw: AuthProviderConfig };

type ProviderMaterializationHandlers<T> = {
  oauth: (
    dispatch: Extract<ProviderMaterializationDispatch, { tag: "oauth" }>,
  ) => T;
  class: (
    dispatch: Extract<ProviderMaterializationDispatch, { tag: "class" }>,
  ) => T;
  factoryOrObject: (
    dispatch: Extract<
      ProviderMaterializationDispatch,
      { tag: "factoryOrObject" }
    >,
  ) => T;
};

function decodeProviderMaterializationDispatch(
  raw: AuthProviderConfig,
): ProviderMaterializationDispatch {
  if (isOAuthProvider(raw)) {
    return { tag: "oauth", raw };
  }
  if (isClassProvider(raw)) {
    return { tag: "class", raw };
  }
  return { tag: "factoryOrObject", raw };
}

function matchProviderMaterializationDispatch<T>(
  dispatch: ProviderMaterializationDispatch,
  handlers: ProviderMaterializationHandlers<T>,
): T {
  return (
    handlers[dispatch.tag] as (dispatch: ProviderMaterializationDispatch) => T
  )(dispatch);
}

function materializeProviderConfig(raw: AuthProviderConfig) {
  const dispatch = decodeProviderMaterializationDispatch(raw);
  return matchProviderMaterializationDispatch(dispatch, {
    oauth: (d) => materializeOAuthProvider(d.raw),
    class: (d) => d.raw._toMaterialized(),
    factoryOrObject: (d) => {
      const resolved = typeof d.raw === "function" ? d.raw() : (d.raw as any);
      const merged = resolved.options
        ? { ...resolved, ...resolved.options }
        : resolved;
      return merged as AuthProviderMaterializedConfig;
    },
  });
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
