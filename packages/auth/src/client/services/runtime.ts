import type { ClientRuntime } from "../core/types";

export type ClientRuntimeService = ClientRuntime;

export const ClientRuntimeLive = (runtime: ClientRuntime): ClientRuntimeService => runtime;
