import type {
  GenericValidator,
  Infer,
  ObjectType,
  PropertyValidators,
} from "convex/values";
import { createBuilder } from "fluent-convex";

import type { DataModel } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

const convex = createBuilder<DataModel>();

type ArgsValidator = PropertyValidators | GenericValidator;

type ArgsFor<TArgs extends ArgsValidator | undefined> =
  TArgs extends PropertyValidators
    ? ObjectType<TArgs>
    : TArgs extends GenericValidator
      ? Infer<TArgs>
      : any;

type ReturnsFor<TReturns extends GenericValidator | undefined> =
  TReturns extends GenericValidator ? Infer<TReturns> : unknown;

type Awaitable<T> = T | Promise<T>;

type BaseFunctionConfig<
  Ctx,
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined,
> = {
  args?: TArgs;
  returns?: TReturns;
  handler: (ctx: Ctx, args: ArgsFor<TArgs>) => Awaitable<ReturnsFor<TReturns>>;
};

function withValidation(
  builder: any,
  config: { args?: ArgsValidator; returns?: GenericValidator },
) {
  let current = builder;
  if (config.args !== undefined) {
    current = current.input(config.args);
  }
  if (config.returns !== undefined) {
    current = current.returns(config.returns);
  }
  return current;
}

export function query<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<QueryCtx, TArgs, TReturns>) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .public();
}

export function mutation<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<MutationCtx, TArgs, TReturns>) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .public();
}

export function internalQuery<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<QueryCtx, TArgs, TReturns>) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .internal();
}

export function internalMutation<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<MutationCtx, TArgs, TReturns>) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .internal();
}

export function action<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<ActionCtx, TArgs, TReturns>) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .public();
}

export function internalAction<
  TArgs extends ArgsValidator | undefined,
  TReturns extends GenericValidator | undefined = undefined,
>(config: BaseFunctionConfig<ActionCtx, TArgs, TReturns>) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .internal();
}
