import { Layer, ServiceMap } from "effect";

import type { ActionTransport } from "../core/types";

export class ClientHttpService extends ServiceMap.Service<
  ClientHttpService,
  { readonly httpClient: ActionTransport | null }
>()("ClientHttpService") {}

export const ClientHttpLive = (httpClient: ActionTransport | null) =>
  Layer.succeed(ClientHttpService)({ httpClient });
