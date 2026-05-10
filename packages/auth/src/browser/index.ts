/**
 * Browser-first auth client for `@robelest/convex-auth/browser`.
 *
 * This entrypoint wraps the framework-agnostic `client(...)`
 * helper with browser defaults such as `ConvexHttpClient`, local storage, URL
 * replacement, OAuth launching, and passkey adapters.
 *
 * @module
 */

import { ConvexHttpClient } from "convex/browser";

import { LOG_LEVELS, logMessage } from "../shared/log";
import {
  client as createClient,
  type AuthApiRefs,
  type ClientOptions,
  type PlatformAuthClient,
} from "../client/index";
import type { SignInImpl } from "../client/core/types";
import { ClientAdapterFactoriesLive, ClientAdaptersLive } from "../client/services/adapters";
import { ClientHttpLive } from "../client/services/http";
import { resolveClientServices } from "../client/services/resolve";
import { ClientRuntimeLive } from "../client/services/runtime";
import { createPasskeyClient } from "./passkey";
import { createBrowserRuntime } from "./runtime";

export type { AuthApiRefs, PlatformAuthClient as AuthClient, ClientOptions } from "../client/index";

/**
 * Create a browser-configured auth client.
 *
 * This is the recommended entrypoint for web apps. It applies browser runtime
 * defaults on top of the framework-agnostic `client(...)`
 * helper, including `ConvexHttpClient` transport discovery and passkey support.
 *
 * @param options - Browser client configuration. See {@link ClientOptions}.
 * @typeParam Api - Auth API references that control which factor helpers are
 *   available on the returned client.
 * @returns A browser auth client with the configured auth helpers.
 */
export function client<Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs>(
  options: ClientOptions<Api>,
): PlatformAuthClient<Api> {
  const url =
    options.proxyPath === undefined ? (options.url ?? inferConvexUrl(options.convex)) : undefined;
  const runtime = mergeBrowserRuntime(options.runtime);

  const services = resolveClientServices({
    runtime: ClientRuntimeLive(runtime),
    adapters: ClientAdaptersLive(options.adapters ?? {}),
    adapterFactories: ClientAdapterFactoriesLive({
      ...options.adapterFactories,
      passkey: options.adapterFactories?.passkey ?? ((deps) => createPasskeyClient(deps)),
    }),
    http: ClientHttpLive(
      options.proxyPath !== undefined
        ? null
        : (options.httpClient ?? (url ? new ConvexHttpClient(url) : null)),
    ),
  });

  const baseClient = createClient({
    ...options,
    storage: options.storage === undefined && options.proxyPath !== undefined ? null : options.storage,
    runtime: services.runtime,
    adapters: services.adapters,
    adapterFactories: services.adapterFactories,
    httpClient: services.httpClient,
  });

  const completeOAuth: typeof baseClient.completeOAuth = async (input) => {
    const result = await baseClient.completeOAuth(input);
    if (result.handled && result.cleanupUrl && services.runtime.location) {
      const current = services.runtime.location.get();
      const cleanupUrl = result.cleanupUrl;
      const relativeUrl =
        current !== null && cleanupUrl.origin === current.origin
          ? `${cleanupUrl.pathname}${cleanupUrl.search}${cleanupUrl.hash}`
          : cleanupUrl.toString();
      await services.runtime.location.replace(relativeUrl);
    }
    return result;
  };

  const initialize: typeof baseClient.initialize = async () => {
    await baseClient.initialize();
    const current = services.runtime.location?.get();
    if (current?.searchParams.has("code") && current.searchParams.has("state")) {
      await completeOAuth(current);
    }
  };

  const signIn: typeof baseClient.signIn = async (provider, ...args) => {
    const params = args[0] as Record<string, unknown> | undefined;
    // Forward through the loose internal signature — TS cannot resolve the
    // generic params type from the wrapper's union-typed `provider` argument.
    const result = await (baseClient.signIn as SignInImpl)(provider, params);
    if (result.kind === "redirect") {
      await services.runtime.oauth?.open(result.redirect);
    }
    return result;
  };

  const browserClient = {
    get state() {
      return baseClient.state;
    },
    initialize,
    param: baseClient.param,
    get invite() {
      return baseClient.invite;
    },
    completeOAuth,
    signIn,
    signOut: baseClient.signOut,
    onChange: baseClient.onChange,
    destroy: baseClient.destroy,
    ...("totp" in baseClient ? { totp: baseClient.totp } : {}),
    ...("device" in baseClient ? { device: baseClient.device } : {}),
    ...("passkey" in baseClient ? { passkey: baseClient.passkey } : {}),
  } as PlatformAuthClient<Api>;

  void initialize().catch((error) => {
    logMessage("convex-auth/browser", LOG_LEVELS.ERROR, [
      "[convex-auth] Browser client initialization failed:",
      error,
    ]);
  });

  return browserClient;
}

function mergeBrowserRuntime(
  runtime: ClientOptions["runtime"],
): NonNullable<ClientOptions["runtime"]> {
  const defaults = createBrowserRuntime();
  return {
    ...defaults,
    ...runtime,
    environment: runtime?.environment ?? defaults.environment,
    proxy: runtime?.proxy ?? defaults.proxy,
    storage: runtime?.storage === undefined ? defaults.storage : runtime.storage,
    location: runtime?.location ?? defaults.location,
    oauth: runtime?.oauth ?? defaults.oauth,
    sync: runtime?.sync ?? defaults.sync,
    mutex: runtime?.mutex ?? defaults.mutex,
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
