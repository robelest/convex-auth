import type { ClientAdapterFactoriesService } from "./adapters";
import type { ClientAdaptersService } from "./adapters";
import type { ClientHttpService } from "./http";
import type { ClientRuntimeService } from "./runtime";

export interface ClientServicesInput {
  runtime: ClientRuntimeService;
  adapters: ClientAdaptersService;
  adapterFactories: ClientAdapterFactoriesService;
  http: ClientHttpService;
}

export function resolveClientServices(input: ClientServicesInput) {
  return {
    runtime: input.runtime,
    adapters: input.adapters,
    adapterFactories: input.adapterFactories,
    httpClient: input.http.httpClient,
  };
}
