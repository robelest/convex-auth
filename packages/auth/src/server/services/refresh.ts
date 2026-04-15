import type { Infer } from "convex/values";
import { Layer, ServiceMap } from "effect";

import { configDefaults } from "../config";
import { refreshSessionImpl, refreshSessionArgs } from "../mutations/refresh";
import type { MutationCtx } from "../types";

export class AuthRefreshService extends ServiceMap.Service<
  AuthRefreshService,
  {
    readonly refresh: (
      ctx: MutationCtx,
      args: Infer<typeof refreshSessionArgs>,
    ) => ReturnType<typeof refreshSessionImpl>;
  }
>()("AuthRefreshService") {}

export const AuthRefreshLive = (config: ReturnType<typeof configDefaults>) =>
  Layer.succeed(AuthRefreshService)({
    refresh: (ctx, args) => refreshSessionImpl(ctx, args, config),
  });
