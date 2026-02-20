import { createBuilder } from "fluent-convex";
import type { GenericValidator, PropertyValidators } from "convex/values";
import type { DataModel } from "./_generated/dataModel";

const convex = createBuilder<DataModel>();

type ArgsValidator = PropertyValidators | GenericValidator;

type FunctionConfig = {
  args?: ArgsValidator;
  returns?: GenericValidator;
  handler: (ctx: any, args: any) => Promise<any> | any;
};

function withValidation(builder: any, config: FunctionConfig) {
  let current = builder;
  if (config.args !== undefined) {
    current = current.input(config.args);
  }
  if (config.returns !== undefined) {
    current = current.returns(config.returns);
  }
  return current;
}

export function query(config: FunctionConfig) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .public();
}

export function mutation(config: FunctionConfig) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .public();
}

export function internalQuery(config: FunctionConfig) {
  return withValidation(convex.query(), config)
    .handler(config.handler)
    .internal();
}

export function internalMutation(config: FunctionConfig) {
  return withValidation(convex.mutation(), config)
    .handler(config.handler)
    .internal();
}

export function action(config: FunctionConfig) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .public();
}

export function internalAction(config: FunctionConfig) {
  return withValidation(convex.action(), config)
    .handler(config.handler)
    .internal();
}
