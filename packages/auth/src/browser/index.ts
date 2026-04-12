import { ConvexHttpClient } from "convex/browser";

import {
  client as createClient,
  type AuthApiRefs,
  type BrowserAuthClient,
  type ClientOptions,
} from "../client/index";
import { createPasskeyClient } from "./passkey";
import { createBrowserRuntime } from "./runtime";
import {
  ClientAdapterFactoriesLive,
  ClientAdaptersLive,
} from "../client/services/adapters";
import { ClientHttpLive } from "../client/services/http";
import { ClientRuntimeLive } from "../client/services/runtime";
import { resolveClientServices } from "../client/services/resolve";
import { Layer } from "effect";

export type {
  AuthApiRefs,
  BrowserAuthClient as AuthClient,
  ClientOptions,
} from "../client/index";

export function client<
  Api extends AuthApiRefs<boolean, boolean, boolean> = AuthApiRefs,
>(options: ClientOptions<Api>): BrowserAuthClient<Api> {
  const url =
    options.proxyPath === undefined
      ? options.url ?? inferConvexUrl(options.convex)
      : undefined;
  const runtime = mergeBrowserRuntime(options.runtime);

  const services = resolveClientServices(
    Layer.mergeAll(
      ClientRuntimeLive(runtime),
      ClientAdaptersLive(options.adapters ?? {}),
      ClientAdapterFactoriesLive({
        ...options.adapterFactories,
        passkey:
          options.adapterFactories?.passkey ?? ((deps) => createPasskeyClient(deps)),
      }),
      ClientHttpLive(
        options.proxyPath !== undefined
          ? null
          : options.httpClient ?? (url ? new ConvexHttpClient(url) : null),
      ),
    ),
  );

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

function mergeBrowserRuntime(runtime: ClientOptions["runtime"]): NonNullable<ClientOptions["runtime"]> {
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
