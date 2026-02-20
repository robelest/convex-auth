import { createBuilder } from "fluent-convex";
import type {
  GenericValidator,
  Infer,
  ObjectType,
  PropertyValidators,
} from "convex/values";
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

type BaseFunctionConfig<Ctx, TArgs extends ArgsValidator | undefined> = {
  args?: TArgs;
  returns?: GenericValidator;
  handler: (ctx: Ctx, args: ArgsFor<TArgs>) => Promise<any> | any;
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

export function query<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<QueryCtx, TArgs>,
) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .public();
}

export function mutation<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<MutationCtx, TArgs>,
) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .public();
}

export function internalQuery<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<QueryCtx, TArgs>,
) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .internal();
}

export function internalMutation<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<MutationCtx, TArgs>,
) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .internal();
}

export function action<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<ActionCtx, TArgs>,
) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .public();
}

export function internalAction<TArgs extends ArgsValidator | undefined>(
  config: BaseFunctionConfig<ActionCtx, TArgs>,
) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .internal();
}
