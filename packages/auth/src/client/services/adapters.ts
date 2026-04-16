import type { ClientAdapterFactories, ClientAdapters } from "../core/types";

export type ClientAdaptersService = ClientAdapters;

export type ClientAdapterFactoriesService = ClientAdapterFactories;

export const ClientAdaptersLive = (
  adapters: ClientAdapters,
): ClientAdaptersService => adapters;

export const ClientAdapterFactoriesLive = (
  adapterFactories: ClientAdapterFactories,
): ClientAdapterFactoriesService => adapterFactories;
