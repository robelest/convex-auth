import type { GenericActionCtx, GenericDataModel } from "convex/server";

type RunCtx = GenericActionCtx<GenericDataModel>;

export type ComponentReadCtx = {
  runQuery: RunCtx["runQuery"];
};

export type ComponentCtx = ComponentReadCtx & {
  runMutation: RunCtx["runMutation"];
};

export type ComponentActionCtx = ComponentCtx & {
  runAction: RunCtx["runAction"];
};
