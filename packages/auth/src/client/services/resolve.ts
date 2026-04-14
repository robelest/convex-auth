import { Effect, Layer, ServiceMap } from "effect";

import {
  ClientAdaptersService,
  ClientAdapterFactoriesService,
} from "./adapters";
import { ClientHttpService } from "./http";
import { ClientRuntimeService } from "./runtime";

type ClientServicesLayer = Layer.Layer<
  | ClientRuntimeService
  | ClientAdaptersService
  | ClientAdapterFactoriesService
  | ClientHttpService
>;

export function resolveClientServices(layer: ClientServicesLayer) {
  const context = Effect.runSync(Effect.scoped(Layer.build(layer)));
  return {
    runtime: ServiceMap.getUnsafe(context, ClientRuntimeService),
    adapters: ServiceMap.getUnsafe(context, ClientAdaptersService),
    adapterFactories: ServiceMap.getUnsafe(
      context,
      ClientAdapterFactoriesService,
    ),
    httpClient: ServiceMap.getUnsafe(context, ClientHttpService).httpClient,
  };
}
