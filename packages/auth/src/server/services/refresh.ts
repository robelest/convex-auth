import { Layer, ServiceMap } from "effect";
import type { Infer } from "convex/values";

import type { GetProviderOrThrowFunc } from "../crypto";
import { configDefaults } from "../config";
import { refreshSessionImpl, refreshSessionArgs } from "../mutations/refresh";
import type { MutationCtx } from "../types";

export class AuthRefreshService extends ServiceMap.Service<
  AuthRefreshService,
  {
    readonly refresh: (
      ctx: MutationCtx,
      args: Infer<typeof refreshSessionArgs>,
      getProviderOrThrow: GetProviderOrThrowFunc,
    ) => ReturnType<typeof refreshSessionImpl>;
  }
>()("AuthRefreshService") {}

export const AuthRefreshLive = (config: ReturnType<typeof configDefaults>) =>
  Layer.succeed(AuthRefreshService)({
    refresh: (ctx, args, getProviderOrThrow) =>
      refreshSessionImpl(ctx, args, getProviderOrThrow, config),
  });
