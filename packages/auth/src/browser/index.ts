/**
 * Browser-first auth client for `@robelest/convex-auth/browser`.
 *
 * This entrypoint wraps the framework-agnostic `client(...)`
 * helper with browser defaults such as `ConvexHttpClient`, local storage, URL
 * replacement, and passkey adapters.
 *
 * @module
 */

import { ConvexHttpClient } from "convex/browser";

import {
  client as createClient,
  type AuthApiRefs,
  type BrowserAuthClient,
  type ClientOptions,
} from "../client/index";
import {
  ClientAdapterFactoriesLive,
  ClientAdaptersLive,
} from "../client/services/adapters";
import { ClientHttpLive } from "../client/services/http";
import { resolveClientServices } from "../client/services/resolve";
import { ClientRuntimeLive } from "../client/services/runtime";
import { createPasskeyClient } from "./passkey";
import { createBrowserRuntime } from "./runtime";

export type {
  AuthApiRefs,
  BrowserAuthClient as AuthClient,
  ClientOptions,
} from "../client/index";

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
 *
 * @example
 * ```ts
 * import { ConvexReactClient } from "convex/react";
 * import { client } from "@robelest/convex-auth/browser";
 * import { api } from "../convex/_generated/api";
 *
 * const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);
 * const auth = client({ convex, api: api.auth });
 * ```
 */
export function client<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
>(options: ClientOptions<Api>): BrowserAuthClient<Api> {
  const url =
    options.proxyPath === undefined
      ? (options.url ?? inferConvexUrl(options.convex))
      : undefined;
  const runtime = mergeBrowserRuntime(options.runtime);

  const services = resolveClientServices({
    runtime: ClientRuntimeLive(runtime),
    adapters: ClientAdaptersLive(options.adapters ?? {}),
    adapterFactories: ClientAdapterFactoriesLive({
      ...options.adapterFactories,
      passkey:
        options.adapterFactories?.passkey ??
        ((deps) => createPasskeyClient(deps)),
    }),
    http: ClientHttpLive(
      options.proxyPath !== undefined
        ? null
        : (options.httpClient ?? (url ? new ConvexHttpClient(url) : null)),
    ),
  });

  return createClient({
    ...options,
    storage:
      options.storage === undefined && options.proxyPath !== undefined
        ? null
        : options.storage,
    runtime: services.runtime,
    adapters: services.adapters,
    adapterFactories: services.adapterFactories,
    httpClient: services.httpClient,
  }) as BrowserAuthClient<Api>;
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
    storage:
      runtime?.storage === undefined ? defaults.storage : runtime.storage,
    location: runtime?.location ?? defaults.location,
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
