import { Layer, ServiceMap } from "effect";

import type { ClientRuntime } from "../core/types";

export class ClientRuntimeService extends ServiceMap.Service<
  ClientRuntimeService,
  ClientRuntime
>()("ClientRuntimeService") {}

export const ClientRuntimeLive = (runtime: ClientRuntime) =>
  Layer.succeed(ClientRuntimeService)(runtime);
