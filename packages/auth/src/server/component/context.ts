import type { GenericDataModel, GenericMutationCtx, GenericQueryCtx } from "convex/server";

export type ComponentReadCtx = {
  runQuery: GenericQueryCtx<GenericDataModel>["runQuery"];
};

export type ComponentCtx = ComponentReadCtx & {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
