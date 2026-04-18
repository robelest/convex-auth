import type { ActionTransport } from "../core/types";

export type ClientHttpService = { readonly httpClient: ActionTransport | null };

export const ClientHttpLive = (httpClient: ActionTransport | null): ClientHttpService => ({
  httpClient,
});
