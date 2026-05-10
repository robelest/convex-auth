/**
 * Expo-first auth client for `@robelest/convex-auth/expo`.
 *
 * This entrypoint wraps the framework-agnostic `client(...)` helper with
 * Expo-native defaults such as SecureStore-backed token persistence, auth
 * session launching, and native passkey support.
 *
 * OAuth in Expo uses direct mode only. Do not configure `proxyPath` for Expo
 * OAuth flows because the proxy flow depends on browser cookies and HTML
 * redirects.
 *
 * @module
 */

import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { ConvexHttpClient } from "convex/browser";

import { LOG_LEVELS, logMessage } from "../shared/log";
import {
  client as createClient,
  type AuthApiRefs,
  type ClientOptions,
  type ClientRuntime,
  type PlatformAuthClient,
} from "../client/index";
import type { SignInImpl } from "../client/core/types";
import { client as createBrowserClient } from "../browser/index";
import { ClientAdapterFactoriesLive, ClientAdaptersLive } from "../client/services/adapters";
import { ClientHttpLive } from "../client/services/http";
import { resolveClientServices } from "../client/services/resolve";
import { ClientRuntimeLive } from "../client/services/runtime";
import { createExpoPasskeyClient } from "./passkey";

export interface ExpoClientOptions<Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs>
  extends ClientOptions<Api> {
  authSession?: AuthSession.AuthSessionRedirectUriOptions & {
    redirectUri?: string;
    preferEphemeralSession?: boolean;
  };
}

export type { AuthApiRefs, PlatformAuthClient as AuthClient } from "../client/index";

const secureStoreStorage = {
  async getItem(key: string): Promise<string | null> {
    return await SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Create an Expo-configured auth client.
 *
 * Native Expo defaults include SecureStore persistence, auth session launch,
 * and native passkey support. Web falls back to the browser entrypoint.
 */
export function client<Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs>(
  options: ExpoClientOptions<Api>,
): PlatformAuthClient<Api> {
  if (isWebRuntime()) {
    return createBrowserClient(options) as PlatformAuthClient<Api>;
  }

  const url =
    options.proxyPath === undefined ? (options.url ?? inferConvexUrl(options.convex)) : undefined;
  const runtime = mergeExpoRuntime(options.runtime);
  const services = resolveClientServices({
    runtime: ClientRuntimeLive(runtime),
    adapters: ClientAdaptersLive(options.adapters ?? {}),
    adapterFactories: ClientAdapterFactoriesLive({
      ...options.adapterFactories,
      passkey: options.adapterFactories?.passkey ?? ((deps) => createExpoPasskeyClient(deps)),
    }),
    http: ClientHttpLive(
      options.proxyPath !== undefined
        ? null
        : (options.httpClient ?? (url ? new ConvexHttpClient(url) : null)),
    ),
  });

  const redirectUri = resolveRedirectUri(options.authSession);
  const baseClient = createClient({
    ...options,
    storage: options.storage === undefined && options.proxyPath !== undefined ? null : options.storage,
    runtime: services.runtime,
    adapters: services.adapters,
    adapterFactories: services.adapterFactories,
    httpClient: services.httpClient,
  });

  const initialize: typeof baseClient.initialize = async () => {
    await baseClient.initialize();
  };

  const signIn: typeof baseClient.signIn = async (provider, ...args) => {
    const params = args[0] as Record<string, unknown> | undefined;
    const nextParams = withRedirectTo(params, redirectUri);
    // Forward through the loose internal signature — TS cannot resolve the
    // generic params type from the wrapper's union-typed `provider` argument.
    const result = await (baseClient.signIn as SignInImpl)(provider, nextParams);
    if (result.kind !== "redirect") {
      return result;
    }
    if (options.proxyPath !== undefined) {
      throw new Error(
        "Expo OAuth is not supported when `proxyPath` is set. Use direct mode with `api` and an Expo redirect URI.",
      );
    }
    const authResult = await WebBrowser.openAuthSessionAsync(result.redirect.toString(), redirectUri, {
      preferEphemeralSession: options.authSession?.preferEphemeralSession,
    });
    if (authResult.type === "success") {
      const completion = await baseClient.completeOAuth(authResult.url);
      if (completion.handled) {
        return { kind: "signedIn" as const };
      }
    }
    return result;
  };

  const expoClient = {
    get state() {
      return baseClient.state;
    },
    initialize,
    param: baseClient.param,
    get invite() {
      return baseClient.invite;
    },
    completeOAuth: baseClient.completeOAuth,
    signIn,
    signOut: baseClient.signOut,
    onChange: baseClient.onChange,
    destroy: baseClient.destroy,
    ...("totp" in baseClient ? { totp: baseClient.totp } : {}),
    ...("device" in baseClient ? { device: baseClient.device } : {}),
    ...("passkey" in baseClient ? { passkey: baseClient.passkey } : {}),
  } as PlatformAuthClient<Api>;

  void initialize().catch((error) => {
    logMessage("convex-auth/expo", LOG_LEVELS.ERROR, [
      "[convex-auth] Expo client initialization failed:",
      error,
    ]);
  });

  return expoClient;
}

function isWebRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function mergeExpoRuntime(runtime: ClientRuntime | undefined): ClientRuntime {
  const defaults: ClientRuntime = {
    environment: "client",
    storage: secureStoreStorage,
  };
  return {
    ...defaults,
    ...runtime,
    environment: runtime?.environment ?? defaults.environment,
    storage: runtime?.storage === undefined ? defaults.storage : runtime.storage,
  };
}

function resolveRedirectUri(options: ExpoClientOptions["authSession"]): string {
  if (options?.redirectUri) {
    return options.redirectUri;
  }
  return AuthSession.makeRedirectUri(options);
}

function withRedirectTo(
  params: Record<string, unknown> | undefined,
  redirectTo: string,
): Record<string, unknown> {
  if (params?.redirectTo !== undefined) {
    return params;
  }
  return {
    ...params,
    redirectTo,
  };
}

function inferConvexUrl(convex: unknown): string | undefined {
  if (!convex || typeof convex !== "object") {
    return undefined;
  }
  const candidate = convex as Record<string, unknown>;
  try {
    if (typeof candidate.url === "string") {
      return candidate.url;
    }
  } catch {
    return undefined;
  }

  try {
    const client =
      typeof candidate.client === "object" && candidate.client !== null
        ? (candidate.client as Record<string, unknown>)
        : undefined;
    return typeof client?.url === "string" ? client.url : undefined;
  } catch {
    return undefined;
  }
}
