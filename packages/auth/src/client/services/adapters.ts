import { Layer, ServiceMap } from "effect";

import type { ClientAdapterFactories, ClientAdapters } from "../core/types";

export class ClientAdaptersService extends ServiceMap.Service<
  ClientAdaptersService,
  ClientAdapters
>()("ClientAdaptersService") {}

export class ClientAdapterFactoriesService extends ServiceMap.Service<
  ClientAdapterFactoriesService,
  ClientAdapterFactories
>()("ClientAdapterFactoriesService") {}

export const ClientAdaptersLive = (adapters: ClientAdapters) =>
  Layer.succeed(ClientAdaptersService)(adapters);

export const ClientAdapterFactoriesLive = (
  adapterFactories: ClientAdapterFactories,
) => Layer.succeed(ClientAdapterFactoriesService)(adapterFactories);
