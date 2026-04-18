import type { Infer } from "convex/values";

import { configDefaults } from "../config";
import { refreshSessionImpl, refreshSessionArgs } from "../mutations/refresh";
import type { MutationCtx } from "../types";

export type AuthRefreshService = {
  readonly refresh: (
    ctx: MutationCtx,
    args: Infer<typeof refreshSessionArgs>,
  ) => ReturnType<typeof refreshSessionImpl>;
};

export const createAuthRefresh = (
  config: ReturnType<typeof configDefaults>,
): AuthRefreshService => ({
  refresh: (ctx, args) => refreshSessionImpl(ctx, args, config),
});
